// POST /api/ask: answer a question about the recipe the cook is following, optionally with a
// photo of what they see. The glasses web app (and later the native app) shows the answer on
// the HUD and reads it aloud. Text in, text out: speech is transcribed on the device.
//
// Request (JSON):
//   recipe       a recipe matching RecipeSchema (models/domain.js)
//   step_index   0-based position in recipe.steps of the step on screen
//   question     what the cook asked, as text
//   servings     optional: servings the cook is making (default recipe.base_servings)
//   image        optional: { mime_type: "image/jpeg" | "image/png" | "image/webp", data: base64 }
// Response: { answer, model, ms }
//
// Gemini runs on Google Cloud in the EU multi-region (location "eu"), authenticated with a
// service account key: GOOGLE_CREDENTIALS_B64 (base64 of the JSON key; base64 because Kamal's
// env files would mangle the key's backslashes) or, for local dev, GOOGLE_APPLICATION_CREDENTIALS
// (path to the JSON key file).

import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { RecipeSchema } from "./models/domain.js";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-4-hydrogen";
const LOCATION = process.env.GEMINI_LOCATION ?? "eu";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 3 * 1024 * 1024; // room for a ~2 MB photo as base64
const RATE_LIMIT_PER_MINUTE = 30; // per client IP: the endpoint is public and every call costs money

const SYSTEM_INSTRUCTION = [
  "You are Cooking Buddy, helping someone who is cooking at home.",
  "They wear smart glasses: your answer appears on a small display and is read aloud.",
  "Answer in one or two short sentences, at most 30 words. Plain text only: no markdown, lists or emoji.",
  "Use the recipe below and focus on the current step. Give amounts for the servings stated, with units.",
  "If a photo is attached, it shows what the cook is looking at right now.",
  "If the recipe doesn't cover the question, use common cooking knowledge.",
  "Take food safety seriously and say clearly when something is unsafe.",
].join("\n");

export const AskRequestSchema = z
  .object({
    recipe: RecipeSchema,
    step_index: z.number().int().nonnegative(),
    question: z.string().trim().min(1).max(500),
    servings: z.number().int().positive().max(100).optional(),
    image: z
      .object({
        mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data: z
          .string()
          .max(2_900_000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64 without a data: prefix"),
      })
      .optional(),
  })
  .refine((r) => r.step_index < r.recipe.steps.length, {
    message: "step_index is past the last step",
    path: ["step_index"],
  });

export async function handleAsk(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST" }, { allow: "POST" });
    return;
  }
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    sendJson(res, 415, { error: "Send JSON with content-type: application/json" });
    return;
  }
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
    sendJson(res, 413, { error: "Request is too large" });
    return;
  }
  if (!allowRequest(clientIp(req))) {
    sendJson(res, 429, { error: "Too many questions. Wait a minute and try again." });
    return;
  }

  let json;
  try {
    json = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch (err) {
    sendJson(res, err.status ?? 400, { error: err.status ? err.message : "Body is not valid JSON" });
    return;
  }
  const parsed = AskRequestSchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: "Invalid request",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  const ai = getClient();
  if (!ai) {
    sendJson(res, 503, { error: "The AI isn't configured on this server" });
    return;
  }

  const started = performance.now();
  try {
    const answer = await askGemini(ai, parsed.data);
    sendJson(res, 200, { answer, model: MODEL, ms: Math.round(performance.now() - started) });
  } catch (err) {
    console.error(`ask failed after ${Math.round(performance.now() - started)} ms:`, err?.message ?? err);
    sendJson(res, 502, { error: "The AI didn't answer. Try again." });
  }
}

async function askGemini(ai, { recipe, step_index, question, servings, image }) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mime_type, data: image.data } });
  parts.push({
    text: [
      recipeContext(recipe, step_index, servings ?? recipe.base_servings),
      "",
      `The cook is on step ${step_index + 1} of ${recipe.steps.length}.`,
      `Question: ${question}`,
    ].join("\n"),
  });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" }, // quick answers matter more than deep reasoning
      maxOutputTokens: 1024,
    },
  });
  const answer = response.text?.trim();
  if (!answer) {
    throw new Error(`empty answer (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
  }
  return answer;
}

function recipeContext(recipe, stepIndex, servings) {
  const factor = servings / recipe.base_servings;
  const lines = [`Recipe: ${recipe.title}, making ${servings} servings.`, "Ingredients:"];
  for (const ing of recipe.ingredients) {
    const unit = ing.base_unit === "unit" ? "" : ` ${ing.base_unit}`;
    const subs = ing.substitutes.length ? ` (substitutes: ${ing.substitutes.join("; ")})` : "";
    lines.push(`- ${round(ing.base_amount * factor)}${unit} ${ing.name}${subs}`);
  }
  lines.push("Steps:");
  recipe.steps.forEach((step, i) => {
    const current = i === stepIndex ? "  <- CURRENT STEP" : "";
    lines.push(`${i + 1}. ${step.title}: ${step.instruction}${current}`);
  });
  return lines.join("\n");
}

function round(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

// --- Gemini client, created on first use --------------------------------------------------

let client;

function getClient() {
  if (client !== undefined) return client;
  client = null;
  try {
    const credentials = loadCredentials();
    if (credentials) {
      client = new GoogleGenAI({
        vertexai: true,
        project: credentials.project_id,
        location: LOCATION,
        googleAuthOptions: { credentials },
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      });
    } else {
      console.warn("ask: no Google credentials set; /api/ask will answer 503");
    }
  } catch (err) {
    console.error("ask: could not load Google credentials:", err.message);
  }
  return client;
}

// The first Gemini call has to fetch a Google access token and open a connection, which
// made the first question take ~8 s instead of ~2 s. Warm both up at startup and every
// 15 minutes with countTokens, which is free.
export function warmUpAi() {
  const ai = getClient();
  if (!ai) return;
  const warm = async () => {
    const started = performance.now();
    try {
      await ai.models.countTokens({ model: MODEL, contents: "warm up" });
      console.log(`ask: ${MODEL} in ${LOCATION} warmed up in ${Math.round(performance.now() - started)} ms`);
    } catch (err) {
      console.error("ask: warm-up failed:", err?.message ?? err);
    }
  };
  warm();
  setInterval(warm, 15 * 60_000).unref();
}

function loadCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_B64) {
    return JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, "base64").toString("utf8"));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  }
  return null;
}

// --- HTTP helpers ------------------------------------------------------------------------

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > limit) reject(Object.assign(new Error("Request is too large"), { status: 413 }));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

export function sendJson(res, status, body, headers = {}) {
  res
    .writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    })
    .end(JSON.stringify(body));
}

// Cloudflare sets cf-connecting-ip; the server only accepts traffic through Cloudflare.
function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return req.headers["cf-connecting-ip"] || forwarded || req.socket.remoteAddress || "unknown";
}

const windows = new Map(); // ip -> { start, count }

function allowRequest(ip) {
  const now = Date.now();
  const w = windows.get(ip);
  if (!w || now - w.start >= 60_000) {
    windows.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= RATE_LIMIT_PER_MINUTE;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, w] of windows) if (now - w.start >= 60_000) windows.delete(ip);
}, 60_000).unref();

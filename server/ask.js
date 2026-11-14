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
// The prompt lives in ai/answer.js, the Gemini client in ai/gemini.js.

import { z } from "zod";
import { answerQuestion } from "./ai/answer.js";
import { MODEL, getClient, withBackup } from "./ai/gemini.js";
import { RecipeSchema } from "./models/domain.js";
import { clientIp, createRateLimiter, readBody, sendJson } from "./http.js";

const MAX_BODY_BYTES = 3 * 1024 * 1024; // room for a ~2 MB photo as base64
const allowRequest = createRateLimiter(30); // per client IP: the endpoint is public and every call costs money

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
    const { value: answer, attempt } = await withBackup((signal) => answerQuestion(ai, parsed.data, signal));
    const ms = Math.round(performance.now() - started);
    console.log(`ask: answered in ${ms} ms${attempt === 2 ? " (backup request won)" : ""}`);
    sendJson(res, 200, { answer, model: MODEL, ms });
  } catch (err) {
    const reason =
      err instanceof AggregateError ? err.errors.map((e) => e?.message ?? e).join(" | ") : (err?.message ?? err);
    console.error(`ask failed after ${Math.round(performance.now() - started)} ms:`, reason);
    sendJson(res, 502, { error: "The AI didn't answer. Try again." });
  }
}

// Shared Gemini client for every AI feature (answers now; camera step detection later).
//
// Gemini runs on Google Cloud in the EU multi-region (location "eu"), authenticated with a
// service account key: GOOGLE_CREDENTIALS_B64 (base64 of the JSON key; base64 because Kamal's
// env files would mangle the key's backslashes) or, for local dev, GOOGLE_APPLICATION_CREDENTIALS
// (path to the JSON key file). API keys can't be used: they only reach the global endpoint.

import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

export const MODEL = process.env.GEMINI_MODEL ?? "gemini-4-hydrogen";
export const LOCATION = process.env.GEMINI_LOCATION ?? "eu";
const REQUEST_TIMEOUT_MS = 20_000;

let client;

// The client, or null when no credentials are configured. Created on first use.
export function getClient() {
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
      console.warn("ai: no Google credentials set; AI endpoints will answer 503");
    }
  } catch (err) {
    console.error("ai: could not load Google credentials:", err.message);
  }
  return client;
}

// The first Gemini call has to fetch a Google access token and open a connection, which
// made the first question take ~8 s instead of ~2 s. Warm both up at startup and every
// 15 minutes with countTokens, which is free.
let lastWarmUp = null; // { ok, ms, at, error? }

export function warmUpAi() {
  const ai = getClient();
  if (!ai) return;
  const warm = async () => {
    const started = performance.now();
    try {
      await ai.models.countTokens({ model: MODEL, contents: "warm up" });
      const ms = Math.round(performance.now() - started);
      lastWarmUp = { ok: true, ms, at: new Date().toISOString() };
      console.log(`ai: ${MODEL} in ${LOCATION} warmed up in ${ms} ms`);
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      lastWarmUp = { ok: false, ms, at: new Date().toISOString(), error: String(err?.message ?? err).slice(0, 300) };
      console.error("ai: warm-up failed:", err?.message ?? err);
    }
  };
  warm();
  setInterval(warm, 15 * 60_000).unref();
}

// For GET /api/status: is the AI configured, and did the last warm-up reach Gemini?
// The warm-up uses countTokens, so checking this costs nothing.
export function aiStatus() {
  return { configured: getClient() !== null, model: MODEL, location: LOCATION, last_warm_up: lastWarmUp };
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

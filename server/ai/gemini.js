// Shared Gemini client for every AI feature (answers now; camera step detection later).
//
// Gemini runs on Google Cloud in the EU multi-region (location "eu"), authenticated with a
// service account key: GOOGLE_CREDENTIALS_B64 (base64 of the JSON key; base64 because Kamal's
// env files would mangle the key's backslashes) or, for local dev, GOOGLE_APPLICATION_CREDENTIALS
// (path to the JSON key file). API keys can't be used: they only reach the global endpoint.

import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

// One model for everything: the fastest, since every answer and recipe is mostly output time.
export const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
export const LOCATION = process.env.GEMINI_LOCATION ?? "eu";
// Finding recipes on the web uses Gemini's Google Search tool, which Google doesn't keep in
// the EU on any endpoint, so it runs on the global endpoint (see CLAUDE.md, "AI").
export const SEARCH_LOCATION = process.env.GEMINI_SEARCH_LOCATION ?? "global";
// The web search can use its own model (GEMINI_SEARCH_MODEL); by default it's MODEL.
export const SEARCH_MODEL = process.env.GEMINI_SEARCH_MODEL ?? MODEL;
const REQUEST_TIMEOUT_MS = 30_000;

const clients = new Map(); // location -> client, or null without credentials

// The client for `location`, or null when no credentials are configured. Created on first use.
export function getClient(location = LOCATION) {
  if (clients.has(location)) return clients.get(location);
  let client = null;
  try {
    const credentials = loadCredentials();
    if (credentials) {
      client = new GoogleGenAI({
        vertexai: true,
        project: credentials.project_id,
        location,
        googleAuthOptions: { credentials },
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      });
    } else {
      console.warn("ai: no Google credentials set; AI endpoints will answer 503");
    }
  } catch (err) {
    console.error("ai: could not load Google credentials:", err.message);
  }
  clients.set(location, client);
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

// Most calls take 1.3–3 s, but now and then Gemini stalls for 7–18 s or fails with
// DEADLINE_EXCEEDED, while its reasoning stays the same size. So withBackup(call) runs
// call(signal); if that hasn't finished after BACKUP_AFTER_MS (or fails sooner), it starts
// one backup call and returns whichever finishes first as { value, attempt }. That costs
// extra only on the slow ~10% of calls. `call` must pass the signal on to Gemini.
// Calls that write a whole recipe (edits, new recipes) take longer, so callers pass their
// own timings: backupAfterMs should sit above that call's normal duration.
const BACKUP_AFTER_MS = Number(process.env.AI_BACKUP_AFTER_MS ?? 3_500); // env override is for testing
const ATTEMPT_TIMEOUT_MS = 10_000;

export async function withBackup(
  call,
  { backupAfterMs = BACKUP_AFTER_MS, attemptTimeoutMs = ATTEMPT_TIMEOUT_MS } = {},
) {
  const controllers = [];
  const attempt = (n) => {
    const controller = new AbortController();
    controllers.push(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(attemptTimeoutMs)]);
    return call(signal).then((value) => ({ value, attempt: n }));
  };
  const first = attempt(1);
  const backup = new Promise((resolve, reject) => {
    const startBackup = () => {
      clearTimeout(timer);
      if (controllers.length < 2) attempt(2).then(resolve, reject);
    };
    const timer = setTimeout(startBackup, backupAfterMs);
    first.then(() => clearTimeout(timer), startBackup);
  });
  try {
    return await Promise.any([first, backup]);
  } finally {
    for (const controller of controllers) controller.abort();
  }
}

// For GET /api/status: is the AI configured, and did the last warm-up reach Gemini?
// The warm-up uses countTokens, so checking this costs nothing.
export function aiStatus() {
  return {
    configured: getClient() !== null,
    model: MODEL,
    location: LOCATION,
    search_model: SEARCH_MODEL,
    last_warm_up: lastWarmUp,
  };
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

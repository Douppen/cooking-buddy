// POST /api/recipes/generate: the recipe for a dish, after POST /api/home sorted the cook's
// words into one ("lasagna"). Gemini first uses Google Search (a real recipe from the web);
// if that call fails, it writes the classic version without search, in the EU.
//
// Request (JSON):  { dish: "lasagna" }
//   No servings: a recipe keeps its own, and the app scales it to the cook's servings setting
//   (which /api/home may have set from what the cook said).
// Response:  { kind: "recipe", recipe, found_online, model, ms }
//   recipe has origin "generated", a "gen-…" id, and `source` ({ name } of the website, or
//   null). found_online is false when the recipe came from the fallback.
//
// The server doesn't keep recipes: the device does. The prompts live in ai/generate.js.

import { z } from "zod";
import { findOnline, writeOffline } from "./ai/generate.js";
import { MODEL, SEARCH_LOCATION, SEARCH_MODEL, getClient, withBackup } from "./ai/gemini.js";
import { createRateLimiter, failureReason, readJsonRequest, sendJson } from "./http.js";

const MAX_BODY_BYTES = 4 * 1024;
// Per client IP: a recipe costs more than an answer.
const allowRequest = createRateLimiter(20);

// The app waits 45 s: search and fallback together stay under that.
const SEARCH_TIMEOUT_MS = 20_000;
const WRITE_BACKUP_AFTER_MS = 8_000;
const WRITE_TIMEOUT_MS = 14_000;

export const GenerateRequestSchema = z.object({
  dish: z.string().trim().min(1).max(200),
});

// For GET /api/status: how the last web search went, so a failing search shows up without
// reading server logs. { ok, ms, at, dish, searched?, source?, queries?, error? }
let lastSearch = null;

export function searchStatus() {
  return { location: SEARCH_LOCATION, last: lastSearch };
}

export async function handleGenerate(req, res) {
  const request = await readJsonRequest(req, res, {
    schema: GenerateRequestSchema,
    maxBytes: MAX_BODY_BYTES,
    allow: allowRequest,
    tooManyMessage: "Too many recipes. Wait a minute and try again.",
  });
  if (!request) return;

  const ai = getClient();
  const searchAi = getClient(SEARCH_LOCATION);
  if (!ai || !searchAi) {
    sendJson(res, 503, { error: "The AI isn't configured on this server" });
    return;
  }

  const { dish } = request;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const at = () => new Date().toISOString();

  // 1. With Google Search. One attempt: a backup search would double the cost, and the
  //    fallback below covers failures.
  try {
    const { recipe, searched, queries } = await findOnline(searchAi, dish, AbortSignal.timeout(SEARCH_TIMEOUT_MS));
    lastSearch = { ok: true, ms: elapsed(), at: at(), dish, queries, searched, source: recipe.source?.name ?? null };
    console.log(
      `generate: found "${recipe.title}" for "${dish}" (${recipe.steps.length} steps) on ${recipe.source?.name ?? "no website (didn't search)"} in ${elapsed()} ms`,
    );
    sendJson(res, 200, { kind: "recipe", recipe, found_online: searched, model: SEARCH_MODEL, ms: elapsed() });
    return;
  } catch (err) {
    lastSearch = { ok: false, ms: elapsed(), at: at(), dish, error: String(failureReason(err)).slice(0, 500) };
    console.error(`generate: web search failed after ${elapsed()} ms, writing it without:`, failureReason(err));
  }

  // 2. Fallback without search (EU): the classic recipe.
  try {
    const { value, attempt } = await withBackup((signal) => writeOffline(ai, dish, signal), {
      backupAfterMs: WRITE_BACKUP_AFTER_MS,
      attemptTimeoutMs: WRITE_TIMEOUT_MS,
    });
    const backup = attempt === 2 ? " (backup request won)" : "";
    console.log(`generate: wrote "${value.recipe.title}" (${value.recipe.steps.length} steps) in ${elapsed()} ms${backup}`);
    sendJson(res, 200, { kind: "recipe", recipe: value.recipe, found_online: false, model: MODEL, ms: elapsed() });
  } catch (err) {
    console.error(`generate failed after ${elapsed()} ms:`, failureReason(err));
    sendJson(res, 502, { error: "Couldn't get that recipe. Try again." });
  }
}

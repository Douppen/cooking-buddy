// POST /api/recipes/generate: the cook names a dish ("I want to cook carbonara for 4") and
// gets a recipe back in the RecipeSchema format. Gemini first looks for a real recipe on the
// web (Google Search); if that fails, it writes the classic version itself.
//
// Request (JSON):  { request: "carbonara for 4", servings?: 4 }
// Response:        { recipe, found_online, model, ms }
//   recipe has origin "generated", a "gen-…" id, and `source` ({ name } of the website, e.g.
//   "bbcgoodfood.com", or null). found_online is false when the recipe came from the fallback
//   or Gemini answered without searching.
//
// The server doesn't keep recipes: the device stores them and sends the whole recipe to
// /api/ask. The prompts live in ai/generate.js.

import { z } from "zod";
import { findRecipeOnline, writeRecipe } from "./ai/generate.js";
import { MODEL, SEARCH_LOCATION, getClient, withBackup } from "./ai/gemini.js";
import { createRateLimiter, failureReason, readJsonRequest, sendJson } from "./http.js";

const MAX_BODY_BYTES = 16 * 1024;
const allowRequest = createRateLimiter(10); // per client IP: a recipe costs more than an answer

// The app waits 45 s for a recipe, so search and fallback together stay under ~40 s.
const SEARCH_TIMEOUT_MS = 20_000;
const WRITE_BACKUP_AFTER_MS = 10_000;
const WRITE_TIMEOUT_MS = 18_000;

export const GenerateRequestSchema = z.object({
  request: z.string().trim().min(1).max(200),
  servings: z.number().int().positive().max(20).optional(),
});

// For GET /api/status: how the last web search went, so a failing search shows up without
// reading server logs. { ok, ms, at, request, searched?, source?, queries?, error? }
let lastSearch = null;

export function searchStatus() {
  return { location: SEARCH_LOCATION, last: lastSearch };
}

export async function handleGenerate(req, res) {
  const request = await readJsonRequest(req, res, {
    schema: GenerateRequestSchema,
    maxBytes: MAX_BODY_BYTES,
    allow: allowRequest,
    tooManyMessage: "Too many new recipes. Wait a minute and try again.",
  });
  if (!request) return;

  const ai = getClient();
  const searchAi = getClient(SEARCH_LOCATION);
  if (!ai || !searchAi) {
    sendJson(res, 503, { error: "The AI isn't configured on this server" });
    return;
  }

  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  // 1. A real recipe from the web. One attempt: a backup search would double the cost, and
  //    the fallback below covers failures.
  try {
    const { recipe, searched, queries } = await findRecipeOnline(searchAi, request, AbortSignal.timeout(SEARCH_TIMEOUT_MS));
    lastSearch = {
      ok: true,
      ms: elapsed(),
      at: new Date().toISOString(),
      request: request.request,
      searched,
      source: recipe.source?.name ?? null,
      queries,
    };
    console.log(
      `generate: found "${recipe.title}" (${recipe.steps.length} steps) on ${recipe.source?.name ?? "no website (didn't search)"} in ${elapsed()} ms`,
    );
    sendJson(res, 200, { recipe, found_online: searched, model: MODEL, ms: elapsed() });
    return;
  } catch (err) {
    lastSearch = {
      ok: false,
      ms: elapsed(),
      at: new Date().toISOString(),
      request: request.request,
      error: String(failureReason(err)).slice(0, 500),
    };
    console.error(`generate: web search failed after ${elapsed()} ms, writing the recipe instead:`, failureReason(err));
  }

  // 2. Fallback: Gemini writes the classic version (EU endpoint, no search).
  try {
    const { value: recipe, attempt } = await withBackup((signal) => writeRecipe(ai, request, signal), {
      backupAfterMs: WRITE_BACKUP_AFTER_MS,
      attemptTimeoutMs: WRITE_TIMEOUT_MS,
    });
    console.log(
      `generate: wrote "${recipe.title}" (${recipe.steps.length} steps) in ${elapsed()} ms` +
        (attempt === 2 ? " (backup request won)" : ""),
    );
    sendJson(res, 200, { recipe, found_online: false, model: MODEL, ms: elapsed() });
  } catch (err) {
    console.error(`generate failed after ${elapsed()} ms:`, failureReason(err));
    sendJson(res, 502, { error: "Couldn't find a recipe for that. Try again." });
  }
}

// POST /api/recipes/generate: the home screen's box. The cook either names a dish ("lasagna")
// and gets a recipe in the RecipeSchema format, or talks about food ("what can I make with
// rice and eggs?") and gets a short answer with dish suggestions. Gemini sorts the request
// in the same call. It first uses Google Search (a real recipe from the web); if that call
// fails, it answers without search.
//
// Request (JSON):  { request: "lasagna", history?: [{ role: "cook" | "buddy", text }] }
//   history: the conversation so far on home (oldest first, up to 10 turns), for follow-ups
//   ("the second one"). No servings: a recipe keeps its own, and the app scales it to the
//   cook's servings setting (the setting always wins over a number in the request).
// Response:
//   { kind: "recipe", recipe, found_online, model, ms }
//     recipe has origin "generated", a "gen-…" id, and `source` ({ name } of the website, or
//     null). found_online is false when the recipe came from the fallback.
//   { kind: "answer", answer, suggestions, model, ms }
//     answer: 1-3 sentences to show and read aloud; suggestions: up to 3 dish names to offer.
//   422 { error, not_a_recipe: true } when the request isn't about food ("write me a poem").
//
// The server doesn't keep recipes or conversations: the device does. The prompts live in
// ai/generate.js.

import { z } from "zod";
import { NotFoodError, findOnline, writeOffline } from "./ai/generate.js";
import { MODEL, SEARCH_LOCATION, SEARCH_MODEL, getClient, withBackup } from "./ai/gemini.js";
import { createRateLimiter, failureReason, readJsonRequest, sendJson } from "./http.js";

const MAX_BODY_BYTES = 16 * 1024;
// Per client IP: a recipe costs more than an answer, but a conversation sends a few requests.
const allowRequest = createRateLimiter(20);

// The app waits 45 s, so search and fallback together stay under ~40 s.
const SEARCH_TIMEOUT_MS = 20_000;
const WRITE_BACKUP_AFTER_MS = 10_000;
const WRITE_TIMEOUT_MS = 18_000;

const NOT_FOOD_MESSAGE = "Let's keep it to food. Ask for a dish, like 'carbonara', or for ideas.";

export const GenerateRequestSchema = z.object({
  request: z.string().trim().min(1).max(200),
  history: z
    .array(z.object({ role: z.enum(["cook", "buddy"]), text: z.string().trim().min(1).max(600) }))
    .max(10)
    .default([]),
});

// withBackup reports both attempts' errors together (AggregateError).
function isNotFood(err) {
  return err instanceof NotFoodError || (err instanceof AggregateError && err.errors.some((e) => e instanceof NotFoodError));
}

// For GET /api/status: how the last web search went, so a failing search shows up without
// reading server logs. { ok, ms, at, request, kind?, searched?, source?, queries?, error? }
let lastSearch = null;

export function searchStatus() {
  return { location: SEARCH_LOCATION, last: lastSearch };
}

export async function handleGenerate(req, res) {
  const request = await readJsonRequest(req, res, {
    schema: GenerateRequestSchema,
    maxBytes: MAX_BODY_BYTES,
    allow: allowRequest,
    tooManyMessage: "Too many requests. Wait a minute and try again.",
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
  const at = () => new Date().toISOString();
  const notFood = () => {
    console.log(`generate: not a food request in ${elapsed()} ms: ${JSON.stringify(request.request).slice(0, 80)}`);
    sendJson(res, 422, { error: NOT_FOOD_MESSAGE, not_a_recipe: true });
  };

  // 1. With Google Search. One attempt: a backup search would double the cost, and the
  //    fallback below covers failures.
  try {
    const result = await findOnline(searchAi, request, AbortSignal.timeout(SEARCH_TIMEOUT_MS));
    lastSearch = { ok: true, ms: elapsed(), at: at(), request: request.request, kind: result.kind, queries: result.queries };
    if (result.kind === "answer") {
      console.log(`generate: answered "${request.request.slice(0, 60)}" in ${elapsed()} ms`);
      sendJson(res, 200, { kind: "answer", answer: result.answer, suggestions: result.suggestions, model: SEARCH_MODEL, ms: elapsed() });
      return;
    }
    const { recipe, searched } = result;
    Object.assign(lastSearch, { searched, source: recipe.source?.name ?? null });
    console.log(
      `generate: found "${recipe.title}" (${recipe.steps.length} steps) on ${recipe.source?.name ?? "no website (didn't search)"} in ${elapsed()} ms`,
    );
    sendJson(res, 200, { kind: "recipe", recipe, found_online: searched, model: SEARCH_MODEL, ms: elapsed() });
    return;
  } catch (err) {
    if (isNotFood(err)) {
      lastSearch = { ok: true, ms: elapsed(), at: at(), request: request.request, kind: "not_food" };
      notFood();
      return;
    }
    lastSearch = { ok: false, ms: elapsed(), at: at(), request: request.request, error: String(failureReason(err)).slice(0, 500) };
    console.error(`generate: web search failed after ${elapsed()} ms, answering without it:`, failureReason(err));
  }

  // 2. Fallback without search (EU endpoint): the classic recipe, or an answer.
  try {
    const { value: result, attempt } = await withBackup((signal) => writeOffline(ai, request, signal), {
      backupAfterMs: WRITE_BACKUP_AFTER_MS,
      attemptTimeoutMs: WRITE_TIMEOUT_MS,
    });
    const backup = attempt === 2 ? " (backup request won)" : "";
    if (result.kind === "answer") {
      console.log(`generate: answered "${request.request.slice(0, 60)}" offline in ${elapsed()} ms${backup}`);
      sendJson(res, 200, { kind: "answer", answer: result.answer, suggestions: result.suggestions, model: MODEL, ms: elapsed() });
      return;
    }
    console.log(`generate: wrote "${result.recipe.title}" (${result.recipe.steps.length} steps) in ${elapsed()} ms${backup}`);
    sendJson(res, 200, { kind: "recipe", recipe: result.recipe, found_online: false, model: MODEL, ms: elapsed() });
  } catch (err) {
    if (isNotFood(err)) {
      notFood();
      return;
    }
    console.error(`generate failed after ${elapsed()} ms:`, failureReason(err));
    sendJson(res, 502, { error: "Couldn't answer that. Try again." });
  }
}

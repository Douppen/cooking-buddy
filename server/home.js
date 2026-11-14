// POST /api/home: the home screen's box. The cook either names a dish to cook ("lasagna",
// "the second one", "yes, let's go") or talks about food ("what can I make with rice and
// eggs?", "a simple middle eastern recipe"). One fast call in the EU, without search, sorts
// it (sortRequest() in ai/generate.js) and writes the answer for food talk. For a dish, the
// app then asks POST /api/recipes/generate for the recipe, and meanwhile shows the dish and
// any servings the cook said.
//
// Request (JSON):  { request: "lasagna for 4", history?: [{ role: "cook" | "buddy", text }] }
//   history: the conversation so far on home (oldest first, up to 10 turns), for follow-ups
//   ("the second one", "yes").
// Response:
//   { kind: "dish", dish, servings, cuisine, handover, model, ms }
//     dish: what to fetch ("lasagna"); servings: the number the cook said ("for 4", "for six
//     people"), or null. The app sets its servings setting to it: what the cook says wins.
//     cuisine: "indian" | "chinese" | "italian" | "mexican" | "french" | "japanese" | "thai"
//     | "eastern_european" | "american" | "other"; the app saves it on the recipe, and that cuisine's cook reads its answers.
//     handover: what the British chef says when the recipe opens ("Alright, here's your
//     butter chicken recipe. Now let me hand you over to my expert colleague, Pankaj.").
//   { kind: "answer", answer, suggestions, model, ms }
//     answer: 1-3 sentences to show and read aloud; suggestions: up to 3 dish names to offer.
//   422 { error, not_a_recipe: true } when the request isn't about food ("write me a poem").
//
// The server keeps no conversations: the device sends the history.

import { z } from "zod";
import { NotFoodError, sortRequest } from "./ai/generate.js";
import { handoverLine } from "./ai/personas.js";
import { MODEL, getClient, withBackup } from "./ai/gemini.js";
import { createRateLimiter, failureReason, readJsonRequest, sendJson } from "./http.js";

const MAX_BODY_BYTES = 16 * 1024;
// Per client IP: a conversation sends a few requests, and each is cheap.
const allowRequest = createRateLimiter(30);

// Sorting takes ~0.5-1 s.
const BACKUP_AFTER_MS = 3_000;
const ATTEMPT_TIMEOUT_MS = 6_000;

const NOT_FOOD_MESSAGE = "Let's keep it to food. Ask for a dish, like 'carbonara', or for ideas.";

export const HomeRequestSchema = z.object({
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

export async function handleHome(req, res) {
  const request = await readJsonRequest(req, res, {
    schema: HomeRequestSchema,
    maxBytes: MAX_BODY_BYTES,
    allow: allowRequest,
    tooManyMessage: "Too many requests. Wait a minute and try again.",
  });
  if (!request) return;

  const ai = getClient();
  if (!ai) {
    sendJson(res, 503, { error: "The AI isn't configured on this server" });
    return;
  }

  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const said = JSON.stringify(request.request.slice(0, 60));
  try {
    const { value: sorted, attempt } = await withBackup((signal) => sortRequest(ai, request, signal), {
      backupAfterMs: BACKUP_AFTER_MS,
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    });
    const backup = attempt === 2 ? " (backup request won)" : "";
    if (sorted.kind === "dish") {
      const servings = sorted.servings ? `, ${sorted.servings} servings` : "";
      console.log(`home: ${said} is the dish "${sorted.dish}"${servings}, ${sorted.cuisine} (${elapsed()} ms)${backup}`);
      sendJson(res, 200, {
        kind: "dish",
        dish: sorted.dish,
        servings: sorted.servings,
        cuisine: sorted.cuisine,
        handover: handoverLine(sorted.dish, sorted.cuisine),
        model: MODEL,
        ms: elapsed(),
      });
      return;
    }
    console.log(`home: answered ${said} in ${elapsed()} ms${backup}`);
    sendJson(res, 200, { kind: "answer", answer: sorted.answer, suggestions: sorted.suggestions, model: MODEL, ms: elapsed() });
  } catch (err) {
    if (isNotFood(err)) {
      console.log(`home: not a food request in ${elapsed()} ms: ${said}`);
      sendJson(res, 422, { error: NOT_FOOD_MESSAGE, not_a_recipe: true });
      return;
    }
    console.error(`home failed after ${elapsed()} ms:`, failureReason(err));
    sendJson(res, 502, { error: "Couldn't answer that. Try again." });
  }
}

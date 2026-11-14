// POST /api/recipes/generate: the cook names a dish ("I want to cook carbonara for 4") and
// gets a classic recipe back, written by Gemini in the RecipeSchema format.
//
// Request (JSON):  { request: "carbonara for 4", servings?: 4 }
// Response:        { recipe, model, ms }   recipe has origin "generated" and a "gen-…" id.
//
// The server doesn't keep generated recipes: the device stores them and sends the whole
// recipe to /api/ask, like any other. The prompt lives in ai/generate.js.

import { z } from "zod";
import { generateRecipe } from "./ai/generate.js";
import { MODEL, getClient, withBackup } from "./ai/gemini.js";
import { createRateLimiter, failureReason, readJsonRequest, sendJson } from "./http.js";

const MAX_BODY_BYTES = 16 * 1024;
const allowRequest = createRateLimiter(10); // per client IP: writing a recipe costs more than an answer

export const GenerateRequestSchema = z.object({
  request: z.string().trim().min(1).max(200),
  servings: z.number().int().positive().max(20).optional(),
});

export async function handleGenerate(req, res) {
  const request = await readJsonRequest(req, res, {
    schema: GenerateRequestSchema,
    maxBytes: MAX_BODY_BYTES,
    allow: allowRequest,
    tooManyMessage: "Too many new recipes. Wait a minute and try again.",
  });
  if (!request) return;

  const ai = getClient();
  if (!ai) {
    sendJson(res, 503, { error: "The AI isn't configured on this server" });
    return;
  }

  const started = performance.now();
  try {
    // Writing a recipe normally takes several seconds, so the backup waits longer than /api/ask's.
    const { value: recipe, attempt } = await withBackup(
      (signal) => generateRecipe(ai, request, signal),
      { backupAfterMs: 15_000, attemptTimeoutMs: 30_000 },
    );
    const ms = Math.round(performance.now() - started);
    console.log(
      `generate: "${recipe.title}" (${recipe.steps.length} steps) in ${ms} ms` +
        (attempt === 2 ? " (backup request won)" : ""),
    );
    sendJson(res, 200, { recipe, model: MODEL, ms });
  } catch (err) {
    console.error(`generate failed after ${Math.round(performance.now() - started)} ms:`, failureReason(err));
    sendJson(res, 502, { error: "Couldn't write that recipe. Try again." });
  }
}

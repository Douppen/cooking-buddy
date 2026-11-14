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
import { clientIp, createRateLimiter, readBody, sendJson } from "./http.js";

const MAX_BODY_BYTES = 16 * 1024;
const allowRequest = createRateLimiter(10); // per client IP: writing a recipe costs more than an answer

export const GenerateRequestSchema = z.object({
  request: z.string().trim().min(1).max(200),
  servings: z.number().int().positive().max(20).optional(),
});

export async function handleGenerate(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST" }, { allow: "POST" });
    return;
  }
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    sendJson(res, 415, { error: "Send JSON with content-type: application/json" });
    return;
  }
  if (!allowRequest(clientIp(req))) {
    sendJson(res, 429, { error: "Too many new recipes. Wait a minute and try again." });
    return;
  }

  let json;
  try {
    json = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch (err) {
    sendJson(res, err.status ?? 400, { error: err.status ? err.message : "Body is not valid JSON" });
    return;
  }
  const parsed = GenerateRequestSchema.safeParse(json);
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
    // Writing a recipe normally takes several seconds, so the backup waits longer than /api/ask's.
    const { value: recipe, attempt } = await withBackup(
      (signal) => generateRecipe(ai, parsed.data, signal),
      { backupAfterMs: 15_000, attemptTimeoutMs: 30_000 },
    );
    const ms = Math.round(performance.now() - started);
    console.log(
      `generate: "${recipe.title}" (${recipe.steps.length} steps) in ${ms} ms` +
        (attempt === 2 ? " (backup request won)" : ""),
    );
    sendJson(res, 200, { recipe, model: MODEL, ms });
  } catch (err) {
    const reason =
      err instanceof AggregateError ? err.errors.map((e) => e?.message ?? e).join(" | ") : (err?.message ?? err);
    console.error(`generate failed after ${Math.round(performance.now() - started)} ms:`, reason);
    sendJson(res, 502, { error: "Couldn't write that recipe. Try again." });
  }
}

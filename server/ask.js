// POST /api/ask: answer a question about the recipe the cook is following, optionally with a
// photo of what they see, and change the recipe when the cook asks ("I don't have
// buttermilk"). The glasses web app (and later the native app) shows the answer on the HUD
// and reads it aloud. Text in, text out: speech is transcribed on the device.
//
// Request (JSON):
//   recipe       a recipe matching RecipeSchema (models/domain.js)
//   step_index   0-based position in recipe.steps of the step on screen
//   question     what the cook asked, as text
//   servings     optional: servings the cook is making (default recipe.base_servings)
//   image        optional: { mime_type: "image/jpeg" | "image/png" | "image/webp", data: base64 }
// Response: { answer, model, ms } plus, when the recipe changed, { recipe, change_summary }:
//   the whole updated recipe (same recipe_id, change_summary appended to edits).
//
// The prompt lives in ai/answer.js, the Gemini client in ai/gemini.js.

import { z } from "zod";
import { answerQuestion } from "./ai/answer.js";
import { MODEL, getClient, withBackup } from "./ai/gemini.js";
import { RecipeSchema, toRecipe } from "./models/domain.js";
import { createRateLimiter, failureReason, readJsonRequest, sendJson } from "./http.js";

// A question takes ~1.5-2.5 s; an answer that changes the recipe also writes the whole
// recipe and takes ~8.5 s (measured). Send the backup request only after that.
const EDIT_BACKUP_AFTER_MS = 10_000;
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
  const request = await readJsonRequest(req, res, {
    schema: AskRequestSchema,
    maxBytes: MAX_BODY_BYTES,
    allow: allowRequest,
    tooManyMessage: "Too many questions. Wait a minute and try again.",
  });
  if (!request) return;

  const ai = getClient();
  if (!ai) {
    sendJson(res, 503, { error: "The AI isn't configured on this server" });
    return;
  }

  const started = performance.now();
  const current = request.recipe;
  try {
    // Building the changed recipe happens inside the call, so an invalid one from the model
    // counts as a failed attempt and the backup request gets a chance.
    const { value, attempt } = await withBackup(
      async (signal) => {
        const { answer, changeSummary, draft } = await answerQuestion(ai, request, signal);
        const recipe = draft
          ? toRecipe(draft, {
              recipe_id: current.recipe_id,
              origin: current.origin,
              edits: [...current.edits, changeSummary],
              previous: current,
            })
          : null;
        return { answer, recipe, changeSummary };
      },
      { backupAfterMs: EDIT_BACKUP_AFTER_MS, attemptTimeoutMs: 20_000 },
    );
    const ms = Math.round(performance.now() - started);
    const what = value.recipe ? `changed the recipe (${value.changeSummary})` : "answered";
    console.log(`ask: ${what} in ${ms} ms${attempt === 2 ? " (backup request won)" : ""}`);
    sendJson(res, 200, {
      answer: value.answer,
      model: MODEL,
      ms,
      ...(value.recipe ? { recipe: value.recipe, change_summary: value.changeSummary } : {}),
    });
  } catch (err) {
    console.error(`ask failed after ${Math.round(performance.now() - started)} ms:`, failureReason(err));
    sendJson(res, 502, { error: "The AI didn't answer. Try again." });
  }
}

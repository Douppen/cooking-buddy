// POST /api/ask: answer a question about the recipe the cook is following, optionally with a
// photo of what they see, and change the recipe when the cook asks ("I don't have
// buttermilk"). The glasses web app (and later the native app) shows the answer on the HUD
// and reads it aloud. Text in, text out: speech is transcribed on the device.
//
// Request (JSON):
//   recipe       a recipe matching RecipeSchema (models/domain.js)
//   step_index   optional: 0-based position in recipe.steps of the step the cook is on.
//                Leave it out for a question about the whole recipe (the web app does:
//                the cook sees all the steps at once).
//   question     what the cook asked, as text
//   previous     optional: { question, answer }, the last exchange, so "yes, do it" makes the
//                change the last answer suggested
//   servings     optional: servings the cook is making (default recipe.base_servings)
//   unit_system  optional: "metric" (default) or "imperial", the units the app shows.
//                Answers use them; the recipe stays metric (a changed one too).
//   image        optional: { mime_type: "image/jpeg" | "image/png" | "image/webp", data: base64 }
// Response: { answer, model, ms } plus, when the recipe changed, { recipe, change_summary }:
//   the whole updated recipe (same recipe_id, change_summary appended to edits). "Make it for
//   6" changes only recipe.servings (1-8), and the app scales the amounts. "Set a timer for 10
//   minutes" adds { timer: { action: "start", seconds, label } } ("cancel the timer": { action:
//   "cancel", label }, "" = all); the app runs the timer. "Send the shopping list to my phone"
//   posts the ingredient list to the cook's phone (phone.js) and answers "Sent the shopping
//   list to your phone.". Then `answer` is
//   just the summary ("Scaled to 6 servings."): the app shows "Recipe updated".
//
// The prompt lives in ai/answer.js, the Gemini client in ai/gemini.js.

import { z } from "zod";
import { answerQuestion } from "./ai/answer.js";
import { MODEL, getClient, withBackup } from "./ai/gemini.js";
import { RecipeSchema, toRecipe } from "./models/domain.js";
import { createRateLimiter, failureReason, readJsonRequest, sendJson } from "./http.js";
import { phoneConnected, sendToPhone, shoppingList } from "./phone.js";

// A question takes ~1.5-2.5 s; an answer that changes the recipe also writes the whole
// recipe and takes ~8.5 s (measured). Send the backup request only after that.
const EDIT_BACKUP_AFTER_MS = 10_000;
const MAX_BODY_BYTES = 3 * 1024 * 1024; // room for a ~2 MB photo as base64
const allowRequest = createRateLimiter(30); // per client IP: the endpoint is public and every call costs money

export const AskRequestSchema = z
  .object({
    recipe: RecipeSchema,
    step_index: z.number().int().nonnegative().optional(),
    question: z.string().trim().min(1).max(500),
    previous: z.object({ question: z.string().trim().max(500), answer: z.string().trim().max(600) }).optional(),
    servings: z.number().int().positive().max(100).optional(),
    unit_system: z.enum(["metric", "imperial"]).optional(),
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
  .refine((r) => r.step_index === undefined || r.step_index < r.recipe.steps.length, {
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
        const { answer, changeSummary, draft, servings, timer, sendList } = await answerQuestion(ai, request, signal);
        if (sendList) return { answer: "", recipe: null, changeSummary: "", timer: null, sendList };
        // New servings ("make it for 6") change only the cook's setting on the recipe: the
        // amounts stay for base_servings and the app scales them.
        const keptServings = servings ?? current.servings;
        const recipe = draft
          ? toRecipe(draft, {
              recipe_id: current.recipe_id,
              origin: current.origin,
              edits: [...current.edits, changeSummary],
              previous: current,
              source: current.source,
              servings: keptServings,
              cuisine: current.cuisine,
            })
          : servings
            ? { ...current, servings }
            : null;
        return { answer, recipe, changeSummary, timer };
      },
      { backupAfterMs: EDIT_BACKUP_AFTER_MS, attemptTimeoutMs: 20_000 },
    );
    if (value.sendList) {
      // "Send the shopping list to my phone": scaled and in the cook's units, like the screen.
      const servings = request.servings ?? current.servings ?? current.base_servings;
      value.answer = await sendList(current, servings, request.unit_system);
    }
    const ms = Math.round(performance.now() - started);
    const what = value.recipe ? `changed the recipe (${value.changeSummary})` : "answered";
    console.log(`ask: ${what} in ${ms} ms${attempt === 2 ? " (backup request won)" : ""}`);
    sendJson(res, 200, {
      answer: value.answer,
      model: MODEL,
      ms,
      ...(value.recipe ? { recipe: value.recipe, change_summary: value.changeSummary } : {}),
      ...(value.timer ? { timer: value.timer } : {}),
    });
  } catch (err) {
    console.error(`ask failed after ${Math.round(performance.now() - started)} ms:`, failureReason(err));
    sendJson(res, 502, { error: "The AI didn't answer. Try again." });
  }
}

// Sends the shopping list to the phone and says how it went.
async function sendList(recipe, servings, unitSystem) {
  if (!phoneConnected()) return "No phone is connected yet, so I couldn't send the list.";
  try {
    await sendToPhone(shoppingList(recipe, servings, unitSystem));
    console.log(`ask: sent the shopping list for "${recipe.title}" (${servings} servings) to the phone`);
    return "Sent the shopping list to your phone.";
  } catch (err) {
    console.error("ask: sending the shopping list failed:", failureReason(err));
    return "Couldn't send the list to your phone. Try again.";
  }
}

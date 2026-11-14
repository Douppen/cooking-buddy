// Answer a cook's question about the recipe they're following, optionally with a photo of
// what they see, and change the recipe when they ask for it ("I don't have buttermilk").
// Used by POST /api/ask. Answers are shown on the HUD and read aloud.

import { convertUnitSystem, scaleIngredients } from "../scaling.js";
import { MODEL } from "./gemini.js";
import { RECIPE_DRAFT_JSON_SCHEMA, RECIPE_WRITING_RULES, recipeToDraft } from "./recipeFormat.js";

const SYSTEM_INSTRUCTION = [
  "You are Cooking Buddy, helping someone who is cooking at home.",
  "They wear smart glasses: your answer appears on a small display and is read aloud.",
  "Answer in one or two short sentences, at most 30 words. Plain text only: no markdown, lists or emoji.",
  "Use the recipe below and focus on the current step. Give amounts for the servings stated, with units.",
  "If a photo is attached, it shows what the cook is looking at right now.",
  "If the recipe doesn't cover the question, use common cooking knowledge.",
  "Take food safety seriously and say clearly when something is unsafe.",
  "",
  "You can also change the recipe. Change it only when the cook says they don't have an ingredient,",
  "can't or don't want to use something, or asks to swap, add, remove or adjust something.",
  "When you change it:",
  "- Make the smallest change that keeps the dish working. Prefer a listed substitute.",
  "- Update every step that mentions what changed. Keep everything else the same: same order, same wording.",
  "- Keep base_servings and write amounts for base_servings, like the recipe JSON you are given.",
  "- Return the whole updated recipe in `recipe` and a few words in `change_summary`, e.g. 'Swapped buttermilk for milk and lemon'.",
  "- In `answer`, tell the cook what changed and what to do now.",
  "If they ask whether they need an ingredient: answer, and if the dish works without it, return the recipe with it marked optional.",
  "For ordinary questions, leave out `recipe` and set `change_summary` to an empty string.",
  "",
  RECIPE_WRITING_RULES,
].join("\n");

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "One or two short sentences for the HUD, read aloud" },
    change_summary: { type: "string", description: "A few words on how the recipe changed, or empty" },
    recipe: { ...RECIPE_DRAFT_JSON_SCHEMA, description: "The whole updated recipe, only if it changed" },
  },
  required: ["answer", "change_summary"],
  propertyOrdering: ["answer", "change_summary", "recipe"],
};

/**
 * @param {import("@google/genai").GoogleGenAI} ai  client from gemini.js
 * @param {{ recipe, step_index: number, question: string, servings?: number,
 *           image?: { mime_type: string, data: string } }} request  a validated /api/ask body
 * @param {AbortSignal} [abortSignal]  cancels the call (used by withBackup in gemini.js)
 * @returns {Promise<{ answer: string, changeSummary: string, draft: object | null }>}
 *   draft is the changed recipe (see RecipeDraftSchema), or null when nothing changed
 */
export async function answerQuestion(ai, { recipe, step_index, question, servings, image }, abortSignal) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mime_type, data: image.data } });
  parts.push({
    text: [
      recipeContext(recipe, step_index, servings ?? recipe.base_servings),
      "",
      `Recipe JSON (amounts for base_servings ${recipe.base_servings}):`,
      JSON.stringify(recipeToDraft(recipe)),
      "",
      `The cook is on step ${step_index + 1} of ${recipe.steps.length}.`,
      `The cook says: ${question}`,
    ].join("\n"),
  });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" }, // quick answers matter more than deep reasoning
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_JSON_SCHEMA,
      maxOutputTokens: 4096,
      abortSignal,
    },
  });
  const usage = response.usageMetadata ?? {};
  console.log(
    `ai: ${MODEL} answered, thinking ${usage.thoughtsTokenCount ?? 0} tokens, ` +
      `answer ${usage.candidatesTokenCount ?? 0} tokens, prompt ${usage.promptTokenCount ?? 0} tokens`,
  );
  let parsed;
  try {
    parsed = JSON.parse(response.text ?? "");
  } catch {
    throw new Error(`unreadable answer (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
  }
  const answer = String(parsed.answer ?? "").trim();
  if (!answer) throw new Error("empty answer");
  const changeSummary = String(parsed.change_summary ?? "").trim();
  return { answer, changeSummary, draft: parsed.recipe && changeSummary ? parsed.recipe : null };
}

// The recipe as plain text: amounts scaled to `servings`, substitutes, current step marked.
export function recipeContext(recipe, stepIndex, servings) {
  const lines = [`Recipe: ${recipe.title}, making ${servings} servings.`, "Ingredients:"];
  const scaled = convertUnitSystem(scaleIngredients(recipe.ingredients, servings / recipe.base_servings), "metric");
  recipe.ingredients.forEach((ing, i) => {
    const optional = ing.optional ? " (optional)" : "";
    const subs = ing.substitutes.length ? ` (substitutes: ${ing.substitutes.join("; ")})` : "";
    lines.push(`- ${scaled[i].display}${optional}${subs}`);
  });
  lines.push("Steps:");
  recipe.steps.forEach((step, i) => {
    const current = i === stepIndex ? "  <- CURRENT STEP" : "";
    lines.push(`${i + 1}. ${step.title}: ${step.instruction}${current}`);
  });
  if (recipe.edits?.length) lines.push(`Changes already made for this cook: ${recipe.edits.join("; ")}.`);
  return lines.join("\n");
}
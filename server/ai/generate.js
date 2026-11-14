// Write a classic recipe for a dish the cook names ("I want to cook carbonara"). Used by
// POST /api/recipes/generate. The result is a full Recipe with origin "generated"; the
// device keeps it, the server doesn't store it.

import { toRecipe } from "../models/domain.js";
import { MODEL } from "./gemini.js";
import { RECIPE_DRAFT_JSON_SCHEMA, RECIPE_WRITING_RULES, generatedRecipeId } from "./recipeFormat.js";

const SYSTEM_INSTRUCTION = [
  "You write recipes for Cooking Buddy, a cooking assistant on smart glasses.",
  "Write the classic, widely known home-cooking version of the dish the cook asks for.",
  "Keep it practical: common ingredients, 4-10 steps, nothing fancy unless they ask for it.",
  "If they name a number of people or servings, use it as base_servings; otherwise use what the dish usually serves.",
  "If the request is vague or not quite a dish, pick the closest sensible dish.",
  RECIPE_WRITING_RULES,
].join("\n");

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {{ request: string, servings?: number }} input  what the cook said, e.g. "carbonara for 4"
 * @param {AbortSignal} [abortSignal]
 */
export async function generateRecipe(ai, { request, servings }, abortSignal) {
  const ask = servings ? `${request} (for ${servings} servings)` : request;
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: `The cook wants to cook: ${ask}` }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" },
      responseMimeType: "application/json",
      responseJsonSchema: RECIPE_DRAFT_JSON_SCHEMA,
      maxOutputTokens: 4096,
      abortSignal,
    },
  });
  const usage = response.usageMetadata ?? {};
  console.log(
    `ai: ${MODEL} wrote a recipe, thinking ${usage.thoughtsTokenCount ?? 0} tokens, ` +
      `output ${usage.candidatesTokenCount ?? 0} tokens`,
  );
  const draft = JSON.parse(response.text ?? "");
  return toRecipe(draft, { recipe_id: generatedRecipeId(draft.title ?? request), origin: "generated", edits: [] });
}

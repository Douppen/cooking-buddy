// Answer a cook's question about the recipe they're following, optionally with a photo of
// what they see, and change the recipe when they ask for it ("I don't have buttermilk",
// "swap the butter for oil"): then there's no answer from Gemini, only what changed.
// Used by POST /api/ask. Answers are shown on the HUD and read aloud.

import { convertUnitSystem, scaleIngredients } from "../scaling.js";
import { MODEL } from "./gemini.js";
import { RECIPE_DRAFT_JSON_SCHEMA, RECIPE_WRITING_RULES, recipeToDraft } from "./recipeFormat.js";

const SYSTEM_INSTRUCTION = [
  "You are Cooking Buddy, helping someone who is cooking at home.",
  "They wear smart glasses: your answer appears on a small display and is read aloud.",
  "Answer in one or two short sentences, at most 30 words. Plain text only: no markdown, lists or emoji.",
  "Use the recipe below. The cook sees the whole recipe at once, so answer about the whole recipe:",
  "if the question could apply to several steps or ingredients, cover the ones that matter.",
  "Only when a step is marked CURRENT STEP, focus on that step.",
  "Give amounts for the servings stated, with units.",
  "If a photo is attached, it shows what the cook is looking at right now.",
  "If the recipe doesn't cover the question, use common cooking knowledge.",
  "Take food safety seriously and say clearly when something is unsafe.",
  "",
  "You can also change the recipe. Change it when the cook tells you to (swap, replace, use, add, remove, skip, leave out, make it vegetarian, less spicy, more garlic) or says they don't have, can't or don't want to use something.",
  "When you change it:",
  "- Make the smallest change that does what they asked and keeps the dish working. Prefer a listed substitute.",
  "- Give a swapped-in ingredient its own right amount and unit for what it replaces, not the old number copied (e.g. 100 g butter -> 80 ml olive oil, 1 tbsp fresh thyme -> 1 tsp dried thyme, 2 eggs -> 2 tbsp ground flaxseed and 6 tbsp water). Update its substitutes too. Anything new a step uses goes in the ingredient list too (the water for flax eggs).",
  "- Rewrite every step that mentions what changed: the ingredient's name, its amount in the text, and the method or time if the new ingredient needs it (tofu browns faster than chicken). Drop a step that only served a removed ingredient. Keep everything else the same: same order, same wording.",
  "- A change that touches several ingredients ('make it vegetarian', 'dairy free') changes all of them.",
  "- Keep base_servings and write amounts for base_servings, like the recipe JSON you are given.",
  "- Return the whole updated recipe in `recipe` and a few words in `change_summary`, e.g. 'Swapped butter for olive oil'. Leave `answer` empty: the app says 'Recipe updated' itself.",
  "When the cook asks to cook for a different number of people or servings ('make it for 6', 'scale it to 2 servings', 'double it' = twice the servings now, 'halve it'), set `servings` to the new number and leave out `recipe` (the app scales the amounts itself), with a few words in `change_summary`, e.g. 'Scaled to 6 servings'. Otherwise set `servings` to 0.",
  "If they ask whether they need an ingredient: answer, and if the dish works without it, return the recipe with it marked optional.",
  "For ordinary questions, write `answer`, leave out `recipe` and set `change_summary` to an empty string.",
  "",
  RECIPE_WRITING_RULES,
].join("\n");

// The app shows the ingredient list above in imperial and converts temperatures and lengths
// in the step text (200°C shows as 400°F, oven temperatures to the nearest 25°F).
const IMPERIAL_NOTE =
  "The cook's display uses imperial units: in `answer`, give amounts as in the ingredient list above " +
  "(oz, lb, cups, tbsp, tsp), temperatures in °F (oven temperatures to the nearest 25°F) and lengths in inches. " +
  "The recipe JSON stays metric: write any changed recipe in metric as usual.";

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    change_summary: { type: "string", description: "A few words on how the recipe changed, or empty" },
    servings: { type: "integer", description: "The new number of servings the cook asked for, or 0" },
    answer: { type: "string", description: "For a question: one or two short sentences, read aloud. Empty when the recipe changed" },
    recipe: { ...RECIPE_DRAFT_JSON_SCHEMA, description: "The whole updated recipe, only if it changed" },
  },
  required: ["change_summary", "servings", "answer"],
  propertyOrdering: ["change_summary", "servings", "answer", "recipe"],
};

/**
 * @param {import("@google/genai").GoogleGenAI} ai  client from gemini.js
 * @param {{ recipe, step_index?: number, question: string, servings?: number,
 *           unit_system?: 'metric' | 'imperial',
 *           image?: { mime_type: string, data: string } }} request  a validated /api/ask body
 * @param {AbortSignal} [abortSignal]  cancels the call (used by withBackup in gemini.js)
 * @returns {Promise<{ answer: string, changeSummary: string, draft: object | null, servings: number | null }>}
 *   draft is the changed recipe (see RecipeDraftSchema), or null when nothing changed;
 *   servings is the new number of servings the cook asked for ("make it for 6"), or null
 */
export async function answerQuestion(ai, { recipe, step_index, question, servings, unit_system, image }, abortSignal) {
  // The request's servings, else the cook's choice saved on the recipe, else its own.
  const making = servings ?? recipe.servings ?? recipe.base_servings;
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mime_type, data: image.data } });
  parts.push({
    text: [
      recipeContext(recipe, step_index, making, unit_system),
      "",
      `Recipe JSON (amounts for base_servings ${recipe.base_servings}):`,
      JSON.stringify(recipeToDraft(recipe)),
      "",
      step_index === undefined
        ? "The cook is looking at the whole recipe."
        : `The cook is on step ${step_index + 1} of ${recipe.steps.length}.`,
      `The cook is making ${making} servings now ('double it' means ${making * 2}, 'halve it' ${Math.max(1, Math.round(making / 2))}).`,
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
  return toAnswer(parsed);
}

// The app's servings setting goes from 1 to 8.
const MAX_SERVINGS = 8;

/**
 * Gemini's reply as { answer, changeSummary, draft, servings }. A change (a new recipe, or
 * new servings) gets a standard answer, the summary as a sentence ("Swapped butter for olive
 * oil."), not Gemini's words: the app only shows and says "Recipe updated".
 */
export function toAnswer(parsed) {
  const changeSummary = String(parsed.change_summary ?? "").trim().replace(/[.!]+$/, "");
  const asked = Math.round(Number(parsed.servings));
  const servings = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, MAX_SERVINGS) : null;
  const draft = parsed.recipe && changeSummary ? parsed.recipe : null;
  if (draft || servings) {
    // Past the app's limit (12 → 8), say what the cook gets.
    const capped = servings && servings !== asked;
    const summary = changeSummary && !capped ? changeSummary : `Scaled to ${servings} servings`;
    const answer = `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`;
    return { answer, changeSummary: summary, draft, servings };
  }
  const answer = String(parsed.answer ?? "").trim();
  if (!answer) throw new Error("empty answer");
  return { answer, changeSummary: "", draft: null, servings: null };
}

// The recipe as plain text: amounts scaled to `servings` in the units the cook sees,
// substitutes, and the current step marked when there is one (stepIndex undefined = a
// question about the whole recipe).
export function recipeContext(recipe, stepIndex, servings, unitSystem = "metric") {
  const lines = [`Recipe: ${recipe.title}, making ${servings} servings.`, "Ingredients:"];
  const scaled = convertUnitSystem(scaleIngredients(recipe.ingredients, servings / recipe.base_servings), unitSystem);
  recipe.ingredients.forEach((ing, i) => {
    const optional = ing.optional ? " (optional)" : "";
    const subs = ing.substitutes.length ? ` (substitutes: ${ing.substitutes.join("; ")})` : "";
    lines.push(`- ${scaled[i].display}${optional}${subs}`);
  });
  lines.push("Steps:");
  if (servings !== recipe.base_servings) {
    lines.push(`(Amounts in the steps are for ${recipe.base_servings} servings; scale them to ${servings}, as the ingredients above are.)`);
  }
  recipe.steps.forEach((step, i) => {
    const current = i === stepIndex ? "  <- CURRENT STEP" : "";
    lines.push(`${i + 1}. ${step.title}: ${step.instruction}${current}`);
  });
  if (recipe.edits?.length) lines.push(`Changes already made for this cook: ${recipe.edits.join("; ")}.`);
  if (unitSystem === "imperial") lines.push(IMPERIAL_NOTE);
  return lines.join("\n");
}
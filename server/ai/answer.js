// Answer a cook's question about the recipe they're following, optionally with a photo of
// what they see. Used by POST /api/ask. Answers are shown on the HUD and read aloud.

import { MODEL } from "./gemini.js";

const SYSTEM_INSTRUCTION = [
  "You are Cooking Buddy, helping someone who is cooking at home.",
  "They wear smart glasses: your answer appears on a small display and is read aloud.",
  "Answer in one or two short sentences, at most 30 words. Plain text only: no markdown, lists or emoji.",
  "Use the recipe below and focus on the current step. Give amounts for the servings stated, with units.",
  "If a photo is attached, it shows what the cook is looking at right now.",
  "If the recipe doesn't cover the question, use common cooking knowledge.",
  "Take food safety seriously and say clearly when something is unsafe.",
].join("\n");

/**
 * @param {import("@google/genai").GoogleGenAI} ai  client from gemini.js
 * @param {{ recipe, step_index: number, question: string, servings?: number,
 *           image?: { mime_type: string, data: string } }} request  a validated /api/ask body
 * @returns {Promise<string>} the answer text
 */
export async function answerQuestion(ai, { recipe, step_index, question, servings, image }) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mime_type, data: image.data } });
  parts.push({
    text: [
      recipeContext(recipe, step_index, servings ?? recipe.base_servings),
      "",
      `The cook is on step ${step_index + 1} of ${recipe.steps.length}.`,
      `Question: ${question}`,
    ].join("\n"),
  });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" }, // quick answers matter more than deep reasoning
      maxOutputTokens: 1024,
    },
  });
  const answer = response.text?.trim();
  if (!answer) {
    throw new Error(`empty answer (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
  }
  return answer;
}

// The recipe as plain text: amounts scaled to `servings`, substitutes, current step marked.
export function recipeContext(recipe, stepIndex, servings) {
  const factor = servings / recipe.base_servings;
  const lines = [`Recipe: ${recipe.title}, making ${servings} servings.`, "Ingredients:"];
  for (const ing of recipe.ingredients) {
    const unit = ing.base_unit === "unit" ? "" : ` ${ing.base_unit}`;
    const subs = ing.substitutes.length ? ` (substitutes: ${ing.substitutes.join("; ")})` : "";
    lines.push(`- ${round(ing.base_amount * factor)}${unit} ${ing.name}${subs}`);
  }
  lines.push("Steps:");
  recipe.steps.forEach((step, i) => {
    const current = i === stepIndex ? "  <- CURRENT STEP" : "";
    lines.push(`${i + 1}. ${step.title}: ${step.instruction}${current}`);
  });
  return lines.join("\n");
}

function round(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

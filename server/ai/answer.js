// Answer a cook's question about the recipe they're following, optionally with a photo of
// what they see, and change the recipe when they ask for it ("I don't have buttermilk",
// "swap the butter for oil"): then there's no answer from Gemini, only what changed.
// Used by POST /api/ask. Answers are shown on the HUD and read aloud.

import { convertUnitSystem, scaleIngredients } from "../scaling.js";
import { MODEL } from "./gemini.js";
import { RECIPE_DRAFT_JSON_SCHEMA, RECIPE_WRITING_RULES, recipeToDraft } from "./recipeFormat.js";
import { characterInstruction } from "./characters.js";
import { personaFor } from "./personas.js";

// Who answers comes first (systemInstruction()): the recipe's cook, with their story; then
// the rules below.
const RULES = [
  "You're helping someone who is cooking this recipe at home.",
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
  "You can also change the recipe, but only for a command: the cook tells you to change it ('swap the butter for oil', 'use honey instead', 'leave out the carrots', 'add more garlic', 'make it vegetarian', 'make it for 6'), or says they don't have something ('I don't have eggs', 'I'm out of buttermilk', 'no butter here': a command to replace it with the best substitute, without asking first).",
  "A question or a wish is not a command, even when it names a swap: 'can I swap the butter?', 'what can I use instead of butter?', 'can I skip the eggs?', 'do I need eggs?', 'is it OK with oil?', 'I'm watching my blood pressure, can I use something else?'. Answer it in `answer` (the options, which one you'd pick and why, in at most 30 words), suggest the change, and leave the recipe as it is: no `recipe`, `servings` 0, empty `change_summary`.",
  "If the cook agrees ('yes', 'do it', 'OK, swap it', 'let's do that') to a change you suggested in your previous answer, that is a command: make that change.",
  "When you change it:",
  "- Make the smallest change that does what they asked and keeps the dish working. Prefer a listed substitute.",
  "- Give a swapped-in ingredient its own right amount and unit for what it replaces, not the old number copied (e.g. 100 g butter -> 80 ml olive oil, 1 tbsp fresh thyme -> 1 tsp dried thyme, 2 eggs -> 2 tbsp ground flaxseed and 6 tbsp water). Update its substitutes too. Anything new a step uses goes in the ingredient list too (the water for flax eggs).",
  "- Rewrite every step that mentions what changed: the ingredient's name, its amount in the text, and the method or time if the new ingredient needs it (tofu browns faster than chicken). Drop a step that only served a removed ingredient. Keep everything else the same: same order, same wording.",
  "- A change that touches several ingredients ('make it vegetarian', 'dairy free') changes all of them.",
  "- Keep base_servings and write amounts for base_servings, like the recipe JSON you are given.",
  "- Return the whole updated recipe in `recipe` and a few words in `change_summary`, e.g. 'Swapped butter for olive oil'. Leave `answer` empty: the app says 'Recipe updated' itself.",
  "When the cook tells you to cook for a different number of people or servings ('make it for 6', 'scale it to 2 servings', 'double it' = twice the servings now, 'halve it'; a question like 'can I make it for 6?' only gets an answer, as above), set `servings` to the new number and leave out `recipe` (the app scales the amounts itself), with a few words in `change_summary`, e.g. 'Scaled to 6 servings'. Otherwise set `servings` to 0.",
  "Timers: when the cook asks for one ('set a timer for 10 minutes', 'time the pasta', 'start a timer for this step', 'remind me in 5 minutes'), set timer.action to 'start', timer.minutes to what they said or else the time in the recipe step they mean (the lower end of a range, e.g. 'Bake 10-12 min' = 10), and timer.label to one or two words for what it times ('Pasta', 'Sauce', 'Oven'; 'Timer' if nothing fits). 'Stop the timer', 'cancel the pasta timer': timer.action 'cancel' with that label ('' for all timers). Leave the recipe as it is. Otherwise timer.action is 'none'.",
  "Shopping list: when the cook asks to send the ingredients or the shopping list to their phone ('send me the shopping list', 'send the ingredients to my phone', 'I need to go shopping, send me what to buy'), set send_list to true and leave the recipe as it is. Otherwise false.",
  "For ordinary questions, write `answer`, leave out `recipe` and set `change_summary` to an empty string.",
  "",
  RECIPE_WRITING_RULES,
].join("\n");

/**
 * The system instruction for a recipe: its cook (its cuisine's, or Giuseppe for an older
 * clearly Italian recipe without one, else the chef), then the rules. The same cook reads
 * the answer aloud (ai/speech.js).
 */
export function systemInstruction(recipe) {
  return `${characterInstruction(personaFor(recipe.cuisine, recipe.title))}\n\n${RULES}`;
}

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
    timer: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["none", "start", "cancel"] },
        minutes: { type: "number", description: "For start: how long" },
        label: { type: "string", description: "One or two words: what it times" },
      },
      required: ["action"],
      propertyOrdering: ["action", "minutes", "label"],
    },
    send_list: { type: "boolean", description: "The cook asked to send the shopping list to their phone" },
    answer: { type: "string", description: "For a question: one or two short sentences, read aloud. Empty when the recipe changed" },
    recipe: { ...RECIPE_DRAFT_JSON_SCHEMA, description: "The whole updated recipe, only if it changed" },
  },
  required: ["change_summary", "servings", "timer", "send_list", "answer"],
  propertyOrdering: ["change_summary", "servings", "timer", "send_list", "answer", "recipe"],
};

/**
 * @param {import("@google/genai").GoogleGenAI} ai  client from gemini.js
 * @param {{ recipe, step_index?: number, question: string, servings?: number,
 *           previous?: { question: string, answer: string }, unit_system?: 'metric' | 'imperial',
 *           image?: { mime_type: string, data: string } }} request  a validated /api/ask body
 * @param {AbortSignal} [abortSignal]  cancels the call (used by withBackup in gemini.js)
 * @returns {Promise<{ answer: string, changeSummary: string, draft: object | null, servings: number | null }>}
 *   draft is the changed recipe (see RecipeDraftSchema), or null when nothing changed;
 *   servings is the new number of servings the cook asked for ("make it for 6"), or null;
 *   timer is { action: "start", seconds, label } or { action: "cancel", label }, or null
 */
export async function answerQuestion(ai, { recipe, step_index, question, previous, servings, unit_system, image }, abortSignal) {
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
      ...(previous ? ["", `Your previous answer, to "${previous.question}": ${previous.answer}`] : []),
      `The cook says: ${question}`,
    ].join("\n"),
  });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: systemInstruction(recipe),
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
// A kitchen timer: up to 12 hours (a slow braise).
const MAX_TIMER_MINUTES = 12 * 60;

/** A timer the cook asked for, or null. "" label on cancel = all timers. */
export function toTimer(timer) {
  const label = String(timer?.label ?? "").trim().slice(0, 24);
  if (timer?.action === "cancel") return { action: "cancel", label };
  if (timer?.action !== "start") return null;
  const minutes = Number(timer.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const seconds = Math.round(Math.min(minutes, MAX_TIMER_MINUTES) * 60);
  return { action: "start", seconds, label: label ? label.charAt(0).toUpperCase() + label.slice(1) : "Timer" };
}

function timerAnswer(timer) {
  if (timer.action === "cancel") return timer.label ? `${timer.label} timer stopped.` : "Timers stopped.";
  const minutes = Math.floor(timer.seconds / 60);
  const seconds = timer.seconds % 60;
  const length = [minutes ? `${minutes} min` : "", seconds ? `${seconds} s` : ""].filter(Boolean).join(" ");
  return timer.label === "Timer" ? `Timer: ${length}.` : `${timer.label} timer: ${length}.`;
}

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
  const timer = toTimer(parsed.timer);
  // Sending the list: ask.js sends it and answers.
  if (parsed.send_list === true && !draft && !servings && !timer) {
    return { answer: "", changeSummary: "", draft: null, servings: null, timer: null, sendList: true };
  }
  if (timer && !draft && !servings) {
    return { answer: timerAnswer(timer), changeSummary: "", draft: null, servings: null, timer };
  }
  if (draft || servings) {
    // Past the app's limit (12 → 8), say what the cook gets.
    const capped = servings && servings !== asked;
    const summary = changeSummary && !capped ? changeSummary : `Scaled to ${servings} servings`;
    const answer = `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`;
    return { answer, changeSummary: summary, draft, servings, timer };
  }
  const answer = String(parsed.answer ?? "").trim();
  if (!answer) throw new Error("empty answer");
  return { answer, changeSummary: "", draft: null, servings: null, timer: null };
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
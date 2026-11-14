// A recipe for the dish the cook names ("I want to cook carbonara for 4"). Used by
// POST /api/recipes/generate. The result is a full Recipe with origin "generated"; the
// device keeps it, the server doesn't store it.
//
// findRecipeOnline(): Gemini searches the web with its Google Search tool, picks one real
//   recipe and rewrites it in our format. `source` is the website it names.
// writeRecipe(): Gemini writes the classic version from its own knowledge. The fallback
//   when the search fails.

import { toRecipe } from "../models/domain.js";
import { MODEL, SEARCH_MODEL } from "./gemini.js";
import { RECIPE_DRAFT_JSON_SCHEMA, RECIPE_WRITING_RULES, generatedRecipeId } from "./recipeFormat.js";

const SERVINGS_RULE =
  "If they name a number of people or servings, use it as base_servings and scale the amounts; otherwise keep the recipe's own servings.";

// Only food: anything else is answered with 422 instead of a recipe (generate.js).
const FOOD_RULE =
  "First decide whether the request is about something to cook or eat: a dish, drink, baked good, snack, " +
  "or a vague food wish ('something with chicken', 'a quick dinner'). If it isn't (any other topic, " +
  "gibberish, a joke, or something that isn't safe to eat), set is_food to false, leave out recipe, " +
  "and don't search. Otherwise set is_food to true.";

/** The request isn't about food ("write me a poem", "asdfgh"); answered with 422, no fallback. */
export class NotFoodError extends Error {
  constructor(request) {
    super(`not a food request: ${JSON.stringify(request).slice(0, 80)}`);
    this.name = "NotFoodError";
  }
}

const SEARCH_INSTRUCTION = [
  "You find recipes for Cooking Buddy, a cooking assistant on smart glasses.",
  FOOD_RULE,
  "Use Google Search to find a real, well-reviewed recipe for the dish the cook asks for, on a reputable recipe website.",
  "Pick one recipe from one page and follow it: its ingredients, amounts and method. Don't mix recipes or invent steps.",
  "Then rewrite it in the format below: amounts in metric, steps short enough for the glasses, a few substitutes.",
  SERVINGS_RULE,
  "If the request is vague or not quite a dish, find the closest sensible dish.",
  "Search with the dish only (e.g. 'stir fry noodles recipe'), never with a website's name, and don't prefer any particular website: pick whichever result best fits the request.",
  "Set source_site to the recipe website's own domain, e.g. from its page address, never a Google link.",
  RECIPE_WRITING_RULES,
].join("\n");

const WRITE_INSTRUCTION = [
  "You write recipes for Cooking Buddy, a cooking assistant on smart glasses.",
  FOOD_RULE,
  "Write the classic, widely known home-cooking version of the dish the cook asks for.",
  "Keep it practical: common ingredients, 4-10 steps, nothing fancy unless they ask for it.",
  SERVINGS_RULE,
  "If the request is vague or not quite a dish, pick the closest sensible dish.",
  RECIPE_WRITING_RULES,
].join("\n");

const IS_FOOD = { type: "boolean", description: "False if the request isn't about something to cook or eat" };

const FOUND_RECIPE_JSON_SCHEMA = {
  type: "object",
  properties: {
    is_food: IS_FOOD,
    source_site: { type: "string", description: "The recipe website's own domain, not a Google link" },
    recipe: RECIPE_DRAFT_JSON_SCHEMA,
  },
  required: ["is_food"],
  propertyOrdering: ["is_food", "source_site", "recipe"],
};

const WRITTEN_RECIPE_JSON_SCHEMA = {
  type: "object",
  properties: { is_food: IS_FOOD, recipe: RECIPE_DRAFT_JSON_SCHEMA },
  required: ["is_food"],
  propertyOrdering: ["is_food", "recipe"],
};

/**
 * @param {import("@google/genai").GoogleGenAI} ai  a client on SEARCH_LOCATION (gemini.js)
 * @param {{ request: string, servings?: number }} input
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<{ recipe: object, searched: boolean, queries: string[] }>}  searched is
 *   false when Gemini answered without actually searching (then the recipe has no source)
 * @throws {NotFoodError} when the request isn't about food
 */
export async function findRecipeOnline(ai, input, abortSignal) {
  const response = await ai.models.generateContent({
    model: SEARCH_MODEL,
    contents: [{ role: "user", parts: [{ text: `The cook wants to cook: ${describe(input)}` }] }],
    config: {
      systemInstruction: SEARCH_INSTRUCTION,
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: "LOW" },
      responseMimeType: "application/json",
      responseJsonSchema: FOUND_RECIPE_JSON_SCHEMA,
      maxOutputTokens: 8192,
      abortSignal,
    },
  });
  const metadata = response.candidates?.[0]?.groundingMetadata;
  logUsage(SEARCH_MODEL, "found a recipe", response, `searched ${JSON.stringify(metadata?.webSearchQueries ?? [])}`);
  const { is_food: isFood, source_site: site, recipe: draft } = parseJson(response);
  if (isFood === false) throw new NotFoodError(input.request);
  const queries = metadata?.webSearchQueries ?? [];
  const source = sourceOf(queries, site);
  return {
    recipe: toRecipe(draft, { recipe_id: generatedRecipeId(draft?.title ?? input.request), origin: "generated", edits: [], source }),
    searched: queries.length > 0,
    queries,
  };
}

/**
 * The fallback: a classic recipe from Gemini's own knowledge, without a source.
 * @throws {NotFoodError} when the request isn't about food
 */
export async function writeRecipe(ai, input, abortSignal) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: `The cook wants to cook: ${describe(input)}` }] }],
    config: {
      systemInstruction: WRITE_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" },
      responseMimeType: "application/json",
      responseJsonSchema: WRITTEN_RECIPE_JSON_SCHEMA,
      maxOutputTokens: 4096,
      abortSignal,
    },
  });
  logUsage(MODEL, "wrote a recipe", response);
  const { is_food: isFood, recipe: draft } = parseJson(response);
  if (isFood === false) throw new NotFoodError(input.request);
  return toRecipe(draft, { recipe_id: generatedRecipeId(draft?.title ?? input.request), origin: "generated", edits: [] });
}

/**
 * The website the recipe came from: the site Gemini names, but only if it actually searched
 * (Google reports its search queries). With our JSON output format Google doesn't return the
 * pages it found, so there is no link, only the site name.
 * @param {string[]} queries  webSearchQueries from Google's grounding metadata
 * @param {string} [site]  source_site from the model, e.g. "https://www.SeriousEats.com/"
 * @returns {{ name: string } | null}  e.g. { name: "seriouseats.com" }
 */
export function sourceOf(queries, site) {
  const name = bareDomain(site ?? "");
  // Google's own redirect links (vertexaisearch.cloud.google.com) aren't the recipe's site.
  const isGoogle = /(^|\.)google\.[a-z.]+$/.test(name) || name.includes("vertexaisearch");
  return queries.length > 0 && name && !isGoogle ? { name } : null;
}

function bareDomain(text) {
  return text.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function describe({ request, servings }) {
  return servings ? `${request} (for ${servings} servings)` : request;
}

function parseJson(response) {
  try {
    return JSON.parse(response.text ?? "");
  } catch {
    throw new Error(`unreadable recipe (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
  }
}

function logUsage(model, what, response, extra = "") {
  const usage = response.usageMetadata ?? {};
  console.log(
    `ai: ${model} ${what}, thinking ${usage.thoughtsTokenCount ?? 0} tokens, ` +
      `output ${usage.candidatesTokenCount ?? 0} tokens${extra ? `, ${extra}` : ""}`,
  );
}

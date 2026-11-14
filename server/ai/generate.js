// The home screen's box: the cook either wants a recipe ("lasagna", "chicken tikka
// masala") or to talk about food ("what can I make with rice and eggs?", "ideas for a light
// dinner"). Used by POST /api/recipes/generate. Gemini sorts the request in the same call:
//   recipe    a full Recipe with origin "generated" (the device keeps it, the server doesn't)
//   answer    a short spoken answer, plus up to 3 dish suggestions the cook can pick
//   not food  NotFoodError (answered with 422)
//
// findOnline(): Gemini with its Google Search tool: finds one real recipe and rewrites it in
//   our format (`source` is the website it names), or answers with what it found.
// writeOffline(): the fallback when the search call fails: the classic recipe from Gemini's own
//   knowledge, or an answer, in the EU without search.

import { toRecipe } from "../models/domain.js";
import { MODEL, SEARCH_MODEL } from "./gemini.js";
import { RECIPE_DRAFT_JSON_SCHEMA, RECIPE_WRITING_RULES, generatedRecipeId } from "./recipeFormat.js";

// The app scales recipes to the cook's servings setting itself, so a recipe always keeps
// its own servings.
const SERVINGS_RULE =
  "Keep the recipe's own number of servings as base_servings, with its amounts, even if the cook names a number of people: the app scales recipes itself.";

const INTENT_RULE = [
  "First decide what the cook wants and set intent:",
  "- 'recipe': only when the cook names one specific dish ('lasagna', 'chicken tikka masala', 'a recipe for banana bread'), or picks one dish from earlier in the conversation ('the second one', 'let's do the curry').",
  "- 'chat': everything else about food, cooking, ingredients or drinks: ideas or inspiration, what to make with what they have, advice, a cooking question ('what can I make with rice and eggs?', 'ideas for a light dinner', 'can I freeze cooked rice?'). A wish for a kind of dish that doesn't name one is 'chat' too, even when phrased as 'give me' or 'make me' ('give me a simple middle eastern dish', 'something quick with chicken', 'a pasta dish'): suggest dishes, don't pick one for them. So is a follow-up that changes or narrows earlier ideas ('something without eggs instead?', 'anything vegetarian?').",
  "- 'not_food': anything that isn't about food, cooking or drinks, even if phrased as a question: sports, news, weather, people, homework, code, jokes, gibberish, or something that isn't safe to eat. Then leave out everything else.",
  "For 'chat': leave out recipe. Write answer: one to three short sentences, at most 30 words, plain text, no lists or markdown; it is read aloud on smart glasses. suggestions: only the dishes your answer itself suggests (up to 3 short dish names the cook could ask a recipe for, e.g. 'Egg fried rice'); for a question that isn't asking for dishes, an empty list.",
  "Earlier turns of the conversation, if any, come before what the cook says now: use them for follow-ups ('the second one' means the second dish Cooking Buddy suggested).",
].join("\n");

/** The request isn't about food ("write me a poem", "asdfgh"); answered with 422, no fallback. */
export class NotFoodError extends Error {
  constructor(request) {
    super(`not a food request: ${JSON.stringify(request).slice(0, 80)}`);
    this.name = "NotFoodError";
  }
}

const SEARCH_INSTRUCTION = [
  "You are Cooking Buddy, a cooking assistant on smart glasses.",
  INTENT_RULE,
  "For 'recipe': use Google Search to find a real, well-reviewed recipe for the dish, on a reputable recipe website.",
  "Pick one recipe from one page and follow it: its ingredients, amounts and method. Don't mix recipes or invent steps.",
  "Then rewrite it in the format below: amounts in metric, steps short enough for the glasses, a few substitutes.",
  SERVINGS_RULE,
  "Search with the dish only (e.g. 'stir fry noodles recipe'), never with a website's name, and don't prefer any particular website: pick whichever result best fits the request.",
  "Set source_site to the recipe website's own domain, e.g. from its page address, never a Google link.",
  RECIPE_WRITING_RULES,
].join("\n");

const WRITE_INSTRUCTION = [
  "You are Cooking Buddy, a cooking assistant on smart glasses.",
  INTENT_RULE,
  "For 'recipe': write the classic, widely known home-cooking version of the dish.",
  "Keep it practical: common ingredients, 4-10 steps, nothing fancy unless they ask for it.",
  SERVINGS_RULE,
  RECIPE_WRITING_RULES,
].join("\n");

const INTENT = { type: "string", enum: ["recipe", "chat", "not_food"] };
const ANSWER = { type: "string", description: "For 'chat': 1-3 short sentences, at most 30 words, read aloud" };
const SUGGESTIONS = {
  type: "array",
  items: { type: "string" },
  description: "For 'chat': up to 3 dish names the cook could ask a recipe for, or empty",
};

const ONLINE_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: INTENT,
    answer: ANSWER,
    suggestions: SUGGESTIONS,
    source_site: { type: "string", description: "For 'recipe': the recipe website's own domain, not a Google link" },
    recipe: RECIPE_DRAFT_JSON_SCHEMA,
  },
  required: ["intent"],
  propertyOrdering: ["intent", "answer", "suggestions", "source_site", "recipe"],
};

const OFFLINE_JSON_SCHEMA = {
  type: "object",
  properties: { intent: INTENT, answer: ANSWER, suggestions: SUGGESTIONS, recipe: RECIPE_DRAFT_JSON_SCHEMA },
  required: ["intent"],
  propertyOrdering: ["intent", "answer", "suggestions", "recipe"],
};

/**
 * @typedef {{ request: string, history?: Array<{ role: "cook" | "buddy", text: string }> }} HomeInput
 * @typedef {{ kind: "recipe", recipe: object, searched: boolean, queries: string[] }
 *         | { kind: "answer", answer: string, suggestions: string[], queries: string[] }} HomeResult
 *   searched is false when Gemini answered without actually searching (no source then)
 */

/**
 * Gemini with Google Search: a real recipe from the web, or an answer.
 * @param {import("@google/genai").GoogleGenAI} ai  a client on SEARCH_LOCATION (gemini.js)
 * @param {HomeInput} input
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<HomeResult>}
 * @throws {NotFoodError} when the request isn't about food
 */
export async function findOnline(ai, input, abortSignal) {
  const response = await ai.models.generateContent({
    model: SEARCH_MODEL,
    contents: [{ role: "user", parts: [{ text: describe(input) }] }],
    config: {
      systemInstruction: SEARCH_INSTRUCTION,
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: "LOW" },
      responseMimeType: "application/json",
      responseJsonSchema: ONLINE_JSON_SCHEMA,
      maxOutputTokens: 8192,
      abortSignal,
    },
  });
  const metadata = response.candidates?.[0]?.groundingMetadata;
  const queries = metadata?.webSearchQueries ?? [];
  logUsage(SEARCH_MODEL, "answered the home box", response, `searched ${JSON.stringify(queries)}`);
  const parsed = parseJson(response);
  return toResult(parsed, input, { queries, source: sourceOf(queries, parsed.source_site) });
}

/**
 * The fallback, without search (EU): the classic recipe from Gemini's own knowledge, without
 * a source, or an answer.
 * @param {HomeInput} input
 * @returns {Promise<HomeResult>}
 * @throws {NotFoodError} when the request isn't about food
 */
export async function writeOffline(ai, input, abortSignal) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: describe(input) }] }],
    config: {
      systemInstruction: WRITE_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" },
      responseMimeType: "application/json",
      responseJsonSchema: OFFLINE_JSON_SCHEMA,
      maxOutputTokens: 4096,
      abortSignal,
    },
  });
  logUsage(MODEL, "answered the home box offline", response);
  return toResult(parseJson(response), input, { queries: [], source: null });
}

/** Gemini's sorted reply as a HomeResult. Throws if it's not food or doesn't hold together. */
export function toResult(parsed, input, { queries, source }) {
  if (parsed.intent === "not_food") throw new NotFoodError(input.request);
  if (parsed.intent === "chat") {
    const answer = String(parsed.answer ?? "").trim();
    if (!answer) throw new Error("chat without an answer");
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 3);
    return { kind: "answer", answer, suggestions, queries };
  }
  const draft = parsed.recipe;
  if (!draft) throw new Error(`no recipe (intent ${JSON.stringify(parsed.intent)})`);
  return {
    kind: "recipe",
    recipe: toRecipe(draft, { recipe_id: generatedRecipeId(draft.title ?? input.request), origin: "generated", edits: [], source }),
    searched: queries.length > 0,
    queries,
  };
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

/** The conversation so far, then what the cook just said. */
function describe({ request, history = [] }) {
  const earlier = history.map(({ role, text }) => `${role === "cook" ? "Cook" : "Cooking Buddy"}: ${text}`);
  return [
    ...(earlier.length ? ["Conversation so far:", ...earlier, ""] : []),
    `The cook says: ${request}`,
  ].join("\n");
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

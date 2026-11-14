// The home screen's box, in two steps (two endpoints, so the app can show the dish and the
// servings it heard while the recipe is fetched):
//
// sortRequest() (POST /api/home): a fast call in the EU, without search, sorts what the
// cook said:
//   a named dish ("lasagna", "chicken tikka masala", "the second one" after ideas, "yes"
//     to an offered dish), with the servings they said ("for 4"), if any
//   food talk ("what can I make with rice and eggs?", "a simple middle eastern recipe"):
//     a short spoken answer, plus up to 3 dish suggestions the cook can pick
//   not food: NotFoodError (answered with 422)
// It always writes the answer too, so food talk is done in one call. A dish only counts when
// the cook (or an earlier suggestion) actually named it: namedDish() checks that in code,
// because the model likes to pick a dish for a vague wish.
//
// Then, for a dish only (POST /api/recipes/generate):
// findOnline(): Gemini with its Google Search tool finds one real recipe and rewrites it in
//   our format (`source` is the website it names).
// writeOffline(): the fallback when the search call fails: the classic recipe from Gemini's
//   own knowledge, in the EU without search.

import { toRecipe } from "../models/domain.js";
import { MODEL, SEARCH_MODEL } from "./gemini.js";
import { RECIPE_DRAFT_JSON_SCHEMA, RECIPE_WRITING_RULES, generatedRecipeId } from "./recipeFormat.js";

// The app scales recipes to the cook's servings setting itself, so a recipe always keeps
// its own servings.
const SERVINGS_RULE =
  "Keep the recipe's own number of servings as base_servings, with its amounts, even if the cook names a number of people: the app scales recipes itself.";

const SORT_INSTRUCTION = [
  "You are Cooking Buddy, a cooking assistant on smart glasses. Sort what the cook says.",
  "dish: the dish to cook, only when the cook names one specific dish ('lasagna', 'chicken curry', 'a recipe for banana bread') or picks one that Cooking Buddy suggested earlier ('the second one', 'let's do the falafel'), or agrees to the dish Cooking Buddy just offered ('yes', 'do it', 'let's go', 'sounds good', 'sure, that one', 'perfect'): then dish is that offered dish. If Cooking Buddy offered several and the cook only agrees without saying which, leave dish empty and ask which one. Write it the way the cook or Cooking Buddy wrote it, without adding words, plus any wish they gave for it ('vegetarian lasagna'). Otherwise leave it empty.",
  "servings: when the cook says how many people or servings to cook for, now or earlier in this conversation ('lasagna for 4', 'yes, for six people', 'enough for two', 'just me' = 1), that number; otherwise 0. Leave the number out of dish.",
  "A cuisine, a meal, an ingredient or a kind of dish is not a dish name, even when the cook says 'recipe', 'give me' or 'make me': 'a simple middle eastern recipe', 'an easy dinner recipe', 'chicken recipe', 'something quick with chicken', 'a pasta dish' all leave dish empty. The test: could you search for that exact dish by its name?",
  "intent: 'recipe' when dish is set; 'chat' for anything else about food, cooking, ingredients or drinks (ideas, what to make with what they have, advice, a cooking question, a follow-up that changes or narrows earlier ideas); 'not_food' for anything that isn't about food, cooking or drinks, even if phrased as a question: sports, news, weather, people, homework, code, jokes, gibberish, or something that isn't safe to eat.",
  "Unless intent is 'not_food', always write answer: one to three short sentences, at most 30 words, plain text, no lists or markdown; it is read aloud on smart glasses. For a vague wish, suggest dishes that fit it. suggestions: only the dishes your answer itself suggests (up to 3 short dish names the cook could ask a recipe for, e.g. 'Egg fried rice'); for a question that isn't asking for dishes, an empty list.",
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
  "You are Cooking Buddy, a cooking assistant on smart glasses. The cook names a dish to cook now.",
  "Use Google Search to find a real, well-reviewed recipe for the dish, on a reputable recipe website.",
  "Pick one recipe from one page and follow it: its ingredients, amounts and method. Don't mix recipes or invent steps.",
  "Then rewrite it in the format below: amounts in metric, steps short enough for the glasses, a few substitutes.",
  SERVINGS_RULE,
  "Search with the dish only (e.g. 'stir fry noodles recipe'), never with a website's name, and don't prefer any particular website: pick whichever result best fits the request.",
  "Set source_site to the recipe website's own domain, e.g. from its page address, never a Google link.",
  RECIPE_WRITING_RULES,
].join("\n");

const WRITE_INSTRUCTION = [
  "You are Cooking Buddy, a cooking assistant on smart glasses. The cook names a dish to cook now.",
  "Write the classic, widely known home-cooking version of the dish.",
  "Keep it practical: common ingredients, 4-10 steps, nothing fancy unless they ask for it.",
  SERVINGS_RULE,
  RECIPE_WRITING_RULES,
].join("\n");

const SORT_JSON_SCHEMA = {
  type: "object",
  properties: {
    dish: { type: "string", description: "The dish the cook named or picked, as written, or empty" },
    intent: { type: "string", enum: ["recipe", "chat", "not_food"] },
    servings: { type: "integer", description: "How many people or servings the cook said, or 0" },
    answer: { type: "string", description: "Unless not_food: 1-3 short sentences, at most 30 words, read aloud" },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "Up to 3 dish names the answer suggests, or empty",
    },
  },
  required: ["dish", "intent"],
  propertyOrdering: ["dish", "intent", "servings", "answer", "suggestions"],
};

const ONLINE_JSON_SCHEMA = {
  type: "object",
  properties: {
    source_site: { type: "string", description: "The recipe website's own domain, not a Google link" },
    recipe: RECIPE_DRAFT_JSON_SCHEMA,
  },
  required: ["source_site", "recipe"],
  propertyOrdering: ["source_site", "recipe"],
};

/**
 * @typedef {{ request: string, history?: Array<{ role: "cook" | "buddy", text: string }> }} HomeInput
 * @typedef {{ kind: "dish", dish: string, servings: number | null }
 *         | { kind: "answer", answer: string, suggestions: string[] }} Sorted
 * @typedef {{ recipe: object, searched: boolean, queries: string[] }} Found
 *   searched is false when Gemini answered without actually searching (no source then)
 */

/**
 * Step 1, in the EU without search: a dish to fetch, or the answer itself.
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {HomeInput} input
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<Sorted>}
 * @throws {NotFoodError} when the request isn't about food
 */
export async function sortRequest(ai, input, abortSignal) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: describe(input) }] }],
    config: {
      systemInstruction: SORT_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" },
      responseMimeType: "application/json",
      responseJsonSchema: SORT_JSON_SCHEMA,
      maxOutputTokens: 1024,
      abortSignal,
    },
  });
  const parsed = parseJson(response);
  logUsage(MODEL, "sorted the home box", response, `intent ${parsed.intent}, dish ${JSON.stringify(parsed.dish ?? "")}`);
  return toSorted(parsed, input);
}

/** Gemini's sorting as a Sorted. A dish nobody named becomes the answer instead. */
export function toSorted(parsed, input) {
  if (parsed.intent === "not_food") throw new NotFoodError(input.request);
  const dish = String(parsed.dish ?? "").trim();
  if (dish && namedDish(dish, input)) return { kind: "dish", dish, servings: servingsOf(parsed.servings) };
  const answer = String(parsed.answer ?? "").trim();
  if (!answer) throw new Error(`no answer (intent ${JSON.stringify(parsed.intent)}, dish ${JSON.stringify(dish)})`);
  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 3);
  return { kind: "answer", answer, suggestions };
}

// The servings the cook said, within the app's 1-8 setting, or null when they said none.
const MAX_SERVINGS = 8;
function servingsOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_SERVINGS) : null;
}

// Words that don't make a dish name ("a recipe for", "classic", "easy").
const FILLER = new Set(
  "a an the and or with of for in on to my me some recipe recipes dish classic easy simple quick homemade best".split(" "),
);

/**
 * Whether the cook (or Cooking Buddy, earlier) actually named this dish: at least half of its
 * words, minus filler, appear in what was said, allowing a typo or a plural. So "the third
 * one" after "(Suggested: Falafel; Hummus; Shakshuka)" gives Shakshuka, but "a simple middle
 * eastern recipe" doesn't.
 */
export function namedDish(dish, { request, history = [] }) {
  const said = new Set(words([request, ...history.map((t) => t.text)].join(" ")));
  const wanted = words(dish).filter((w) => !FILLER.has(w));
  if (!wanted.length) return false;
  const found = wanted.filter((w) => [...said].some((s) => sameWord(w, s)));
  return found.length * 2 >= wanted.length;
}

function words(text) {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]+/g) ?? [];
}

function sameWord(a, b) {
  if (a === b) return true;
  const stem = (w) => w.replace(/(es|s)$/, "");
  if (stem(a) === stem(b)) return true;
  return Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= Math.floor(Math.max(a.length, b.length) / 5);
}

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * Step 2 for a dish, with Google Search: a real recipe from the web.
 * @param {import("@google/genai").GoogleGenAI} ai  a client on SEARCH_LOCATION (gemini.js)
 * @param {string} dish  from sortRequest()
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<Found>}
 */
export async function findOnline(ai, dish, abortSignal) {
  const response = await ai.models.generateContent({
    model: SEARCH_MODEL,
    contents: [{ role: "user", parts: [{ text: `The dish: ${dish}` }] }],
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
  logUsage(SEARCH_MODEL, `found ${JSON.stringify(dish)}`, response, `searched ${JSON.stringify(queries)}`);
  const parsed = parseJson(response);
  return toFound(parsed.recipe, dish, { queries, source: sourceOf(queries, parsed.source_site) });
}

/**
 * The fallback, without search (EU): the classic recipe from Gemini's own knowledge, without
 * a source.
 * @param {string} dish
 * @returns {Promise<Found>}
 */
export async function writeOffline(ai, dish, abortSignal) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: `The dish: ${dish}` }] }],
    config: {
      systemInstruction: WRITE_INSTRUCTION,
      thinkingConfig: { thinkingLevel: "LOW" },
      responseMimeType: "application/json",
      responseJsonSchema: RECIPE_DRAFT_JSON_SCHEMA,
      maxOutputTokens: 4096,
      abortSignal,
    },
  });
  logUsage(MODEL, `wrote ${JSON.stringify(dish)}`, response);
  return toFound(parseJson(response), dish, { queries: [], source: null });
}

/** A recipe draft from Gemini as a Recipe the device keeps. */
export function toFound(draft, dish, { queries, source }) {
  if (!draft) throw new Error("no recipe");
  return {
    recipe: toRecipe(draft, { recipe_id: generatedRecipeId(draft.title ?? dish), origin: "generated", edits: [], source }),
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

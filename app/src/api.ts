// Calls to the Cooking Buddy server. Recipes live on the device (recipeStore.ts): the AI
// writes them (/api/recipes/generate) and each question sends the whole recipe back to
// /api/ask unchanged, so the server sees exactly what the cook follows, edits included.

import type {BaseUnit, UnitSystem} from './units';

export interface Ingredient {
  id: string;
  name: string;
  /** Amount for the recipe's base_servings, in base_unit. */
  base_amount: number;
  /** 'unit' = a count (eggs, cloves). tsp, tbsp and pinch look the same in both systems. */
  base_unit: BaseUnit;
  substitutes: string[];
  /** The dish still works without it. */
  optional?: boolean;
  /** A count that only comes whole (eggs, garlic cloves): never 0.3 egg, at least 1. */
  whole?: boolean;
}

export interface RecipeStep {
  title: string;
  instruction: string;
}

export interface Recipe {
  recipe_id: string;
  title: string;
  base_servings: number;
  /** The servings the cook picked (the setting on home); amounts are for base_servings. */
  servings?: number | null;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  /** 'generated' = written by the AI. 'library' = from the old server recipe files. */
  origin?: 'library' | 'generated';
  /** Short notes on changes the AI made for this cook, oldest first. */
  edits?: string[];
  [field: string]: unknown;
}

export interface Answer {
  answer: string;
  /** The whole updated recipe, when the cook's words changed it ("I don't have eggs"). */
  recipe?: Recipe;
}

// The server may send a backup request (see server/ai/gemini.js), and an answer that edits
// the recipe takes ~8.5 s, writing a new recipe ~8 s. These cover the server's worst case.
const ASK_TIMEOUT_MS = 30_000;
const HOME_TIMEOUT_MS = 15_000;
const GENERATE_TIMEOUT_MS = 45_000;

/** One turn of the conversation on home, oldest first, sent back so follow-ups work. */
export interface Turn {
  role: 'cook' | 'buddy';
  text: string;
}

/**
 * What the home box gives back: a dish to fetch (with the servings the cook said, if any),
 * or an answer with dishes to offer.
 */
export type HomeReply =
  | {kind: 'dish'; dish: string; servings: number | null}
  | {kind: 'answer'; answer: string; suggestions: string[]};

/**
 * The home box: a dish ("lasagna for 4", "the second one", "yes") gives the dish to fetch
 * with findRecipe(), and the servings the cook said; food talk ("ideas for a light dinner")
 * gives a short answer and up to 3 dish suggestions. `history` is the conversation so far.
 * Anything not about food throws a ServerMessageError with the server's words.
 */
export async function askHome(request: string, history: Turn[], signal: AbortSignal): Promise<HomeReply> {
  const body = await postJson('/api/home', {request, history}, signal, HOME_TIMEOUT_MS);
  if (body.kind === 'answer' && typeof body.answer === 'string') {
    const suggestions = Array.isArray(body.suggestions) ? body.suggestions.filter((s): s is string => typeof s === 'string') : [];
    return {kind: 'answer', answer: body.answer, suggestions};
  }
  if (body.kind !== 'dish' || typeof body.dish !== 'string') throw new Error('No dish in the reply');
  const servings = typeof body.servings === 'number' && body.servings >= 1 ? body.servings : null;
  return {kind: 'dish', dish: body.dish, servings};
}

/** A real recipe from the web for a dish from askHome(), in our format. */
export async function findRecipe(dish: string, signal: AbortSignal): Promise<Recipe> {
  const body = await postJson('/api/recipes/generate', {dish}, signal, GENERATE_TIMEOUT_MS);
  if (!body.recipe) throw new Error('No recipe in the reply');
  return body.recipe as Recipe;
}

/**
 * Ask about the whole recipe (no step_index: the cook sees all the steps at once). The
 * answer gives amounts in the cook's unit system; the recipe itself stays metric.
 */
export async function askQuestion(
  recipe: Recipe,
  question: string,
  unitSystem: UnitSystem,
  signal: AbortSignal,
): Promise<Answer> {
  const body = await postJson('/api/ask', {recipe, question, unit_system: unitSystem}, signal, ASK_TIMEOUT_MS);
  if (typeof body.answer !== 'string' || !body.answer) throw new Error('No answer');
  return {answer: body.answer, recipe: body.recipe as Recipe | undefined};
}

/** A failure the server explained in words meant for the cook ("That doesn't sound like something to cook…"). */
export class ServerMessageError extends Error {}

async function postJson(
  url: string,
  payload: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    if (typeof body.error === 'string') throw new ServerMessageError(body.error);
    throw new Error(`${url} answered ${res.status}`);
  }
  return body;
}

// Calls to the Cooking Buddy server. Recipes live on the device (recipeStore.ts): the AI
// writes them (/api/recipes/generate) and each question sends the whole recipe back to
// /api/ask unchanged, so the server sees exactly what the cook follows, edits included.

import type {UnitSystem} from './units';

export interface Ingredient {
  id: string;
  name: string;
  /** Amount for the recipe's base_servings, in base_unit. */
  base_amount: number;
  /** 'unit' = a count (eggs, cloves). */
  base_unit: 'g' | 'ml' | 'unit';
  substitutes: string[];
  /** The dish still works without it. */
  optional?: boolean;
}

export interface RecipeStep {
  title: string;
  instruction: string;
}

export interface Recipe {
  recipe_id: string;
  title: string;
  base_servings: number;
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
const GENERATE_TIMEOUT_MS = 45_000;

/** Ask the AI to write a classic recipe for a dish, e.g. "carbonara for 4". */
export async function generateRecipe(request: string, signal: AbortSignal): Promise<Recipe> {
  const body = await postJson('/api/recipes/generate', {request}, signal, GENERATE_TIMEOUT_MS);
  if (!body.recipe) throw new Error('No recipe in the answer');
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
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `${url} answered ${res.status}`);
  return body;
}

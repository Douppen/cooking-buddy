// Calls to the Cooking Buddy server. The recipe is passed back to /api/ask unchanged, so
// the server sees exactly the recipe the cook is following (including any AI edits).

export interface RecipeStep {
  title: string;
  instruction: string;
}

export interface Recipe {
  recipe_id: string;
  title: string;
  base_servings: number;
  steps: RecipeStep[];
  /** 'library' = from the server's recipe files; 'generated' = written by the AI. */
  origin?: 'library' | 'generated';
  /** Short notes on changes the AI made for this cook, oldest first. */
  edits?: string[];
  [field: string]: unknown;
}

/** One row of GET /api/recipes. */
export interface RecipeSummary {
  recipe_id: string;
  title: string;
  base_servings: number;
  step_count: number;
}

export interface Answer {
  answer: string;
  /** The whole updated recipe, when the cook's words changed it ("I don't have eggs"). */
  recipe?: Recipe;
}

export class RecipeNotFoundError extends Error {}

// The server may send a backup request (see server/ai/gemini.js), and an answer that edits
// the recipe takes ~8.5 s, writing a new recipe ~8 s. These cover the server's worst case.
const ASK_TIMEOUT_MS = 30_000;
const GENERATE_TIMEOUT_MS = 45_000;

export async function listRecipes(signal: AbortSignal): Promise<RecipeSummary[]> {
  return (await getJson('/api/recipes', signal)) as RecipeSummary[];
}

export async function loadRecipe(id: string): Promise<Recipe> {
  const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new RecipeNotFoundError(`No recipe ${id}`);
  if (!res.ok) throw new Error(`Recipe ${id} answered ${res.status}`);
  return (await res.json()) as Recipe;
}

/** Ask the AI to write a classic recipe for a dish, e.g. "carbonara for 4". */
export async function generateRecipe(request: string, signal: AbortSignal): Promise<Recipe> {
  const body = await postJson('/api/recipes/generate', {request}, signal, GENERATE_TIMEOUT_MS);
  if (!body.recipe) throw new Error('No recipe in the answer');
  return body.recipe as Recipe;
}

export async function askQuestion(
  recipe: Recipe,
  stepIndex: number,
  question: string,
  signal: AbortSignal,
): Promise<Answer> {
  const body = await postJson('/api/ask', {recipe, step_index: stepIndex, question}, signal, ASK_TIMEOUT_MS);
  if (typeof body.answer !== 'string' || !body.answer) throw new Error('No answer');
  return {answer: body.answer, recipe: body.recipe as Recipe | undefined};
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {signal});
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
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

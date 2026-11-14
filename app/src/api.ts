// Calls to the Cooking Buddy server. The recipe is passed back to /api/ask unchanged, so
// the server sees exactly the recipe the cook is following.

export interface RecipeStep {
  title: string;
  instruction: string;
}

export interface Recipe {
  recipe_id: string;
  title: string;
  base_servings: number;
  steps: RecipeStep[];
  [field: string]: unknown;
}

const ASK_TIMEOUT_MS = 15_000; // the server may send a backup request after 3.5 s (see server/ask.js)

export async function loadFirstRecipe(signal: AbortSignal): Promise<Recipe> {
  const list = (await getJson('/api/recipes', signal)) as {recipe_id: string}[];
  if (list.length === 0) throw new Error('No recipes on the server');
  return (await getJson(`/api/recipes/${list[0].recipe_id}`, signal)) as Recipe;
}

export async function askQuestion(
  recipe: Recipe,
  stepIndex: number,
  question: string,
  signal: AbortSignal,
): Promise<string> {
  const timeout = AbortSignal.timeout(ASK_TIMEOUT_MS);
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({recipe, step_index: stepIndex, question}),
    signal: AbortSignal.any([signal, timeout]),
  });
  const body = (await res.json()) as {answer?: string; error?: string};
  if (!res.ok || !body.answer) throw new Error(body.error ?? `Server answered ${res.status}`);
  return body.answer;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {signal});
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

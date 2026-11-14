// How the AI reads and writes recipes. Gemini returns a "draft" (RecipeDraftSchema in
// models/domain.js): a recipe without the server-owned fields. These are shared by
// generate.js (write a new recipe) and answer.js (edit the cook's recipe).

// JSON Schema for Gemini's structured output (responseJsonSchema). It only supports a
// subset of JSON Schema, so keep to type/enum/items/anyOf/required/minimum/maximum.
// No minItems/maxItems: with them on both the ingredient and step lists Gemini rejects the
// schema as INVALID_ARGUMENT (too complex). RecipeDraftSchema enforces list lengths instead.
const INGREDIENT = {
  type: "object",
  properties: {
    name: { type: "string", description: "Ingredient with any prep, e.g. 'Garlic cloves, thinly sliced'" },
    base_amount: { type: "number", minimum: 0, description: "Amount for base_servings" },
    base_unit: {
      type: "string",
      enum: ["g", "ml", "unit", "tsp", "tbsp", "pinch"],
      description:
        "g for solids, ml for liquids, unit for countable things (eggs, cloves, lemons); " +
        "tsp/tbsp for small amounts of salt, spices, leaveners, extracts; pinch only for 1 or 2 pinches",
    },
    substitutes: { type: "array", items: { type: "string" }, description: "Common swaps, at most 2" },
    optional: { type: "boolean", description: "True only if the dish works fine without it" },
  },
  required: ["name", "base_amount", "base_unit", "substitutes", "optional"],
  propertyOrdering: ["name", "base_amount", "base_unit", "substitutes", "optional"],
};

const STEP = {
  type: "object",
  properties: {
    title: { type: "string", description: "Two or three word action heading" },
    instruction: { type: "string", description: "One action, at most 18 words, with the amount and unit of every ingredient it uses, e.g. 'Heat 25 ml olive oil and brown 750 g beef mince in two batches'" },
    visual_cues: { type: "array", items: { type: "string" }, description: "What done looks like, at most 2" },
    timer_sec: {
      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
      description: "Seconds to wait or cook in this step, or null",
    },
  },
  required: ["title", "instruction", "visual_cues", "timer_sec"],
  propertyOrdering: ["title", "instruction", "visual_cues", "timer_sec"],
};

export const RECIPE_DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short dish name" },
    base_servings: { type: "integer", minimum: 1, maximum: 20 },
    ingredients: { type: "array", items: INGREDIENT },
    steps: { type: "array", items: STEP },
  },
  required: ["title", "base_servings", "ingredients", "steps"],
  propertyOrdering: ["title", "base_servings", "ingredients", "steps"],
};

export const RECIPE_WRITING_RULES = [
  "Recipe format rules:",
  "- Amounts for base_servings: g for solids, ml for liquids, unit for countable things.",
  "- Small amounts go in spoons, tsp or tbsp, as the source has them (keep its spoons; never convert them to grams or ml): salt, pepper, spices, dried herbs, baking powder or soda, extracts, and small amounts of oil, vinegar, soy sauce, lemon juice and similar. Up to about 3 tbsp; more goes in g or ml.",
  "- 'pinch' only for 1 or 2 pinches (e.g. a pinch of salt); otherwise use tsp.",
  "- Ingredient names are plain and include prep, e.g. 'Garlic cloves, thinly sliced'.",
  "- Give 0-2 common substitutes per ingredient. Set optional to true only for things the dish works without (garnishes, extras).",
  "- Steps are in cooking order, one action each, at most 18 words, readable at a glance on smart glasses.",
  "- Every step names the amount and unit of each ingredient it uses, as plain text matching the ingredient list, e.g. 'Heat 25 ml olive oil in the pan and brown 750 g beef mince in two batches'. Counted things as numbers: '2 garlic cloves'. If an ingredient is split across steps, give each step its share ('Add half the stock, 250 ml').",
  "- Every step that cooks, bakes, rests, chills or waits says how long in its text (e.g. 'Bake 10-12 min until golden'), and its heat level. Set timer_sec for those steps, otherwise null.",
  "- Temperatures always in Celsius, written like '200°C' (fan ovens: '180°C fan'). Convert °F and gas marks from any source. Lengths in cm or mm.",
  "- visual_cues: 0-2 short phrases describing what the step looks like when done.",
].join("\n");

/** The recipe as the AI sees it: a draft without server-owned fields. */
export function recipeToDraft(recipe) {
  return {
    title: recipe.title,
    base_servings: recipe.base_servings,
    ingredients: recipe.ingredients.map(({ name, base_amount, base_unit, substitutes, optional }) => ({
      name,
      base_amount,
      base_unit,
      substitutes,
      optional,
    })),
    steps: recipe.steps.map(({ title, instruction, visual_cues, timer_sec }) => ({
      title,
      instruction,
      visual_cues,
      timer_sec,
    })),
  };
}

/** A short random id for a generated recipe, safe for /api/recipes/:id-style routes. */
export function generatedRecipeId(title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "recipe";
  return `gen-${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

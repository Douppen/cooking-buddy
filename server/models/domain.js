/**
 * server/models/domain.js - Canonical domain entities.
 */

import { z } from "zod";

export const IngredientSchema = z.object({
  id: z.string().describe("Clean snake_case identifier (e.g. 'heavy_cream')"),
  name: z.string().describe("Display name (e.g. 'Heavy Cream')"),
  base_amount: z
    .number()
    .positive()
    .describe("Canonical quantity corresponding to Recipe.base_servings"),
  base_unit: z
    .enum(["g", "ml", "unit"])
    .describe("Normalized metric unit: 'g', 'ml', or 'unit'"),
  substitutes: z
    .array(z.string())
    .default([])
    .describe("Direct ingredient replacements for Q&A answers"),
  optional: z
    .boolean()
    .default(false)
    .describe("The dish still works without it (answers 'do I need this?')"),
});

export const StepSchema = z.object({
  index: z.number().int().nonnegative().describe("0-indexed sequence order"),
  title: z.string().describe("Concise action heading (e.g. 'Sear Chicken')"),
  instruction: z
    .string()
    .describe("Glanceable directive (<= 15 words) for glasses HUD"),
  visual_cues: z
    .array(z.string())
    .default([])
    .describe("What the step looks like when done, for answers and later camera step detection"),
  timer_sec: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe("Active cooking timer in seconds"),
});

export const RecipeSchema = z.object({
  recipe_id: z.string(),
  title: z.string(),
  base_servings: z.number().int().positive(),
  ingredients: z.array(IngredientSchema).nonempty(),
  steps: z.array(StepSchema).nonempty(),
  origin: z
    .enum(["library", "generated"])
    .default("library")
    .describe("'generated' = written by the AI for a cook; 'library' = from the removed server recipe files (older saved recipes)"),
  edits: z
    .array(z.string())
    .default([])
    .describe("Short notes on changes the AI made for this cook, oldest first"),
});

// What the AI writes when it creates or edits a recipe: the recipe without the fields the
// server owns (recipe_id, step index, origin, edits). toRecipe() turns it into a Recipe.
export const RecipeDraftSchema = z.object({
  title: z.string().min(1).max(80),
  base_servings: z.number().int().positive().max(20),
  ingredients: z
    .array(IngredientSchema.omit({ id: true }).extend({ name: z.string().min(1).max(60) }))
    .min(1)
    .max(25),
  steps: z
    .array(StepSchema.omit({ index: true }).extend({ instruction: z.string().min(1).max(160) }))
    .min(1)
    .max(15),
});

/**
 * Builds a full Recipe from an AI draft: numbers the steps, gives ingredients unique ids
 * (reusing `previous` ids for ingredients whose name didn't change, so an edit doesn't
 * rename what it didn't touch), and sets the server-owned fields. Throws if the result
 * isn't a valid Recipe.
 */
export function toRecipe(draft, { recipe_id, origin, edits, previous }) {
  const parsed = RecipeDraftSchema.parse(draft);
  const previousIds = new Map((previous?.ingredients ?? []).map((ing) => [ing.name.toLowerCase(), ing.id]));
  const used = new Set();
  const ingredients = parsed.ingredients.map((ing) => {
    const kept = previousIds.get(ing.name.toLowerCase());
    const base =
      kept ?? (ing.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "ingredient");
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return { id, ...ing };
  });
  const steps = parsed.steps.map((step, index) => ({ index, ...step }));
  return RecipeSchema.parse({ ...parsed, recipe_id, ingredients, steps, origin, edits });
}

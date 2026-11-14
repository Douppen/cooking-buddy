// Recipes live as JSON files in recipes/, validated against RecipeSchema at startup, so a
// broken recipe file stops the server (and the deploy) instead of failing on a user.
//
//   GET /api/recipes        [{ recipe_id, title, base_servings, step_count }]
//   GET /api/recipes/:id    the full recipe

import { readdirSync, readFileSync } from "node:fs";
import { RecipeSchema } from "./models/domain.js";

const dir = new URL("./recipes/", import.meta.url);

const recipes = new Map(
  readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const parsed = RecipeSchema.safeParse(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
      if (!parsed.success) {
        throw new Error(`recipes/${file} is not a valid recipe: ${parsed.error.message}`);
      }
      return [parsed.data.recipe_id, parsed.data];
    }),
);

export function listRecipes() {
  return [...recipes.values()].map((r) => ({
    recipe_id: r.recipe_id,
    title: r.title,
    base_servings: r.base_servings,
    step_count: r.steps.length,
  }));
}

export function getRecipe(id) {
  return recipes.get(id) ?? null;
}

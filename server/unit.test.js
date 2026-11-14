// Fast checks that need no server and no Gemini: `npm test` (node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertUnitSystem, scaleIngredients } from "./scaling.js";
import { getRecipe, listRecipes } from "./recipes.js";
import { toRecipe } from "./models/domain.js";
import { AskRequestSchema } from "./ask.js";
import { GenerateRequestSchema } from "./generate.js";
import { recipeContext } from "./ai/answer.js";
import { generatedRecipeId, recipeToDraft } from "./ai/recipeFormat.js";

const recipe = getRecipe("buttermilk-pancakes");

test("recipe files load and validate", () => {
  assert.ok(listRecipes().length >= 1);
  assert.equal(recipe.title, "Buttermilk Pancakes");
});

test("scaling and unit conversion", () => {
  const butter = recipe.ingredients.find((i) => i.id === "butter");
  const [metric] = convertUnitSystem(scaleIngredients([butter], 0.5), "metric");
  assert.equal(metric.display, "15 g Butter, melted");
  const egg = recipe.ingredients.find((i) => i.id === "egg");
  assert.equal(convertUnitSystem(scaleIngredients([egg], 1), "metric")[0].display, "2 Egg");
  const milk = recipe.ingredients.find((i) => i.id === "buttermilk");
  assert.equal(convertUnitSystem(scaleIngredients([milk], 1), "imperial")[0].display, "2.03 cups Buttermilk");
});

test("answer prompt scales amounts and marks the current step", () => {
  const text = recipeContext(recipe, 2, 2);
  assert.match(text, /making 2 servings/);
  assert.match(text, /- 125 g Plain flour/);
  assert.match(text, /- 1 Egg/);
  assert.equal(text.match(/<- CURRENT STEP/g).length, 1);
  assert.match(text, /^3\. .*<- CURRENT STEP$/m);
});

test("ask request validation", () => {
  assert.ok(AskRequestSchema.safeParse({ recipe, step_index: 0, question: "How much butter?" }).success);
  assert.equal(AskRequestSchema.safeParse({ recipe, step_index: 99, question: "x" }).success, false);
  assert.equal(AskRequestSchema.safeParse({ recipe, step_index: 0, question: "  " }).success, false);
});

test("AI drafts become valid recipes", () => {
  // A library recipe survives a round trip through the AI's draft format unchanged.
  const roundTrip = toRecipe(recipeToDraft(recipe), {
    recipe_id: recipe.recipe_id,
    origin: recipe.origin,
    edits: recipe.edits,
    previous: recipe,
  });
  assert.deepEqual(roundTrip, recipe);
  // Duplicate names get unique ids, steps are numbered, defaults are filled in.
  const id = generatedRecipeId("Spaghetti Carbonara!");
  assert.match(id, /^gen-spaghetti-carbonara-[a-z0-9]+$/);
  const made = toRecipe(
    {
      title: "Toast",
      base_servings: 1,
      ingredients: [
        { name: "Bread", base_amount: 1, base_unit: "unit", substitutes: [], optional: false },
        { name: "Bread", base_amount: 10, base_unit: "g", substitutes: [], optional: true },
      ],
      steps: [{ title: "Toast", instruction: "Toast the bread.", visual_cues: [], timer_sec: null }],
    },
    { recipe_id: id, origin: "generated", edits: [] },
  );
  assert.deepEqual(made.ingredients.map((i) => i.id), ["bread", "bread_2"]);
  assert.equal(made.steps[0].index, 0);
  assert.equal(made.origin, "generated");
  assert.throws(() => toRecipe({ title: "Nothing", base_servings: 1, ingredients: [], steps: [] }, {
    recipe_id: "x", origin: "generated", edits: [],
  }));
});

test("generate request validation", () => {
  assert.ok(GenerateRequestSchema.safeParse({ request: "carbonara for 4" }).success);
  assert.ok(GenerateRequestSchema.safeParse({ request: "lasagne", servings: 6 }).success);
  assert.equal(GenerateRequestSchema.safeParse({ request: "   " }).success, false);
  assert.equal(GenerateRequestSchema.safeParse({ request: "x", servings: 0 }).success, false);
});

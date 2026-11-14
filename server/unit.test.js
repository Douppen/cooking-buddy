// Fast checks that need no server and no Gemini: `npm test` (node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RecipeEngine, convertUnitSystem, scaleIngredients } from "./engine.js";
import { RecipeSession } from "./session.js";
import { getRecipe, listRecipes } from "./recipes.js";
import { AskRequestSchema } from "./ask.js";
import { recipeContext } from "./ai/answer.js";

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

test("RecipeEngine navigation and HUD state", () => {
  const engine = new RecipeEngine(recipe, 2);
  engine.nextStep();
  const hud = engine.getHudState();
  assert.equal(hud.active_step_index, 1);
  assert.equal(hud.target_servings, 2);
  assert.ok(hud.display_ingredients.includes("125 g Plain flour"));
  engine.setServings(2.5); // ignored: servings must be whole
  assert.equal(engine.getHudState().target_servings, 2);
});

test("RecipeSession view and steps", () => {
  const session = new RecipeSession({ id: "t1", recipe });
  const view = session.getView();
  assert.equal(view.recipeName, "Buttermilk Pancakes");
  assert.equal(view.servings, 4);
  assert.equal(view.currentStep.title, "Mix dry");
  assert.ok(session.setStep(5));
  assert.ok(session.nextStep());
  assert.equal(session.getView().isFinished, true);
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

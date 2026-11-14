// Fast checks that need no server and no Gemini: `npm test` (node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanAmount, cleanAmountsInText, cleanSpoon, convertUnitSystem, scaleIngredients, spoons, toCelsiusInText } from "./scaling.js";
import { RecipeSchema, toRecipe } from "./models/domain.js";
import { AskRequestSchema } from "./ask.js";
import { GenerateRequestSchema } from "./generate.js";
import { sourceOf } from "./ai/generate.js";
import { recipeContext } from "./ai/answer.js";
import { generatedRecipeId, recipeToDraft } from "./ai/recipeFormat.js";

// A fixed test recipe; the app itself has no built-in recipes (the AI writes them).
const recipe = RecipeSchema.parse(
  JSON.parse(readFileSync(new URL("./fixtures/buttermilk-pancakes.json", import.meta.url), "utf8")),
);

test("test recipe validates", () => {
  assert.equal(recipe.title, "Buttermilk Pancakes");
});

test("scaling and unit conversion", () => {
  const butter = recipe.ingredients.find((i) => i.id === "butter");
  const [metric] = convertUnitSystem(scaleIngredients([butter], 0.5), "metric");
  assert.equal(metric.display, "15 g Butter, melted");
  const egg = recipe.ingredients.find((i) => i.id === "egg");
  assert.equal(convertUnitSystem(scaleIngredients([egg], 1), "metric")[0].display, "2 Egg");
  const milk = recipe.ingredients.find((i) => i.id === "buttermilk");
  assert.equal(convertUnitSystem(scaleIngredients([milk], 1), "imperial")[0].display, "2 cups Buttermilk");
});

// Same table as app/src/units.test.ts: the app shows these, the AI gets the same.
test("imperial amounts match the app", () => {
  const shown = (amount, base_unit) =>
    convertUnitSystem([{ id: "x", name: "X", amount, base_unit }], "imperial")[0].display.replace(/ X$/, "");
  const cases = [
    [250, "g", "8.8 oz"], [300, "g", "11 oz"], [1, "g", "0.1 oz"], [450, "g", "1 lb"], [1000, "g", "2.2 lb"],
    [1, "ml", "¼ tsp"], [5, "ml", "1 tsp"], [10, "ml", "2 tsp"], [15, "ml", "1 tbsp"], [30, "ml", "2 tbsp"],
    [60, "ml", "¼ cup"], [80, "ml", "⅓ cup"], [150, "ml", "⅔ cup"], [250, "ml", "1 cup"],
    [300, "ml", "1¼ cups"], [480, "ml", "2 cups"], [1000, "ml", "4¼ cups"], [2, "unit", "2"],
  ];
  for (const [amount, unit, expected] of cases) assert.equal(shown(amount, unit), expected, `${amount} ${unit}`);
});

test("answer prompt scales amounts, all steps, and a current step only when given", () => {
  const whole = recipeContext(recipe, undefined, 2);
  assert.match(whole, /making 2 servings/);
  assert.match(whole, /- 125 g Plain flour/);
  assert.match(whole, /- 1 Egg/);
  assert.equal(whole.match(/^\d+\. /gm).length, recipe.steps.length);
  assert.doesNotMatch(whole, /CURRENT STEP/);
  const onStep = recipeContext(recipe, 2, 2);
  assert.equal(onStep.match(/<- CURRENT STEP/g).length, 1);
  assert.match(onStep, /^3\. .*<- CURRENT STEP$/m);
});

test("answer prompt in imperial units", () => {
  const imperial = recipeContext(recipe, undefined, 4, "imperial");
  assert.match(imperial, /- 2 cups Buttermilk/);
  assert.match(imperial, /imperial units/);
  assert.doesNotMatch(recipeContext(recipe, undefined, 4), /imperial/);
});

test("ask request validation", () => {
  assert.ok(AskRequestSchema.safeParse({ recipe, question: "How much butter?" }).success);
  assert.ok(AskRequestSchema.safeParse({ recipe, question: "How much butter?", unit_system: "imperial" }).success);
  assert.equal(AskRequestSchema.safeParse({ recipe, question: "x", unit_system: "cups" }).success, false);
  assert.ok(AskRequestSchema.safeParse({ recipe, step_index: 0, question: "How much butter?" }).success);
  assert.equal(AskRequestSchema.safeParse({ recipe, step_index: 99, question: "x" }).success, false);
  assert.equal(AskRequestSchema.safeParse({ recipe, step_index: 0, question: "  " }).success, false);
});

test("AI drafts become valid recipes", () => {
  // A recipe survives a round trip through the AI's draft format unchanged.
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

test("temperatures in text become Celsius", () => {
  assert.equal(toCelsiusInText("Bake at 350°F for 12 min."), "Bake at 180°C for 12 min.");
  assert.equal(toCelsiusInText("Preheat oven to 375 degrees F."), "Preheat oven to 190°C.");
  assert.equal(toCelsiusInText("Heat to 400 degrees Fahrenheit"), "Heat to 200°C");
  assert.equal(toCelsiusInText("Fry at 350F until golden."), "Fry at 180°C until golden.");
  assert.equal(toCelsiusInText("Bake at 325-350 °F."), "Bake at 160–180°C.");
  assert.equal(toCelsiusInText("Cook until 145°F inside."), "Cook until 63°C inside.");
  assert.equal(toCelsiusInText("Bake at gas mark 6."), "Bake at 200°C.");
  // Uneven Celsius oven temperatures from an exact conversion become dial settings.
  assert.equal(toCelsiusInText("Preheat to 177°C."), "Preheat to 175°C.");
  assert.equal(toCelsiusInText("Bake at 191 degrees Celsius"), "Bake at 190°C");
  // Left alone: Celsius already, and numbers that aren't temperatures.
  for (const text of ["Bake at 200°C (180°C fan).", "Add 2 eggs and 3 Fuji apples.", "Grade F 2 flour"]) {
    assert.equal(toCelsiusInText(text), text);
  }
});

test("amounts are rounded the way recipes write them", () => {
  const cases = { 0.3: 0.5, 1.2: 1, 2.4: 2.5, 7.3: 7, 19: 20, 56.7: 55, 113: 110, 125: 125, 175: 175, 227: 230, 480: 480, 1130: 1150, 1250: 1250 };
  for (const [raw, clean] of Object.entries(cases)) assert.equal(cleanAmount(Number(raw)), clean, `${raw}`);
  assert.equal(cleanAmountsInText("Add 56 g butter and 113ml milk, then 2 eggs."), "Add 55 g butter and 110ml milk, then 2 eggs.");
  assert.equal(cleanAmountsInText("Stir in 0.5 tsp salt and 1.5 tbsp oil."), "Stir in ½ tsp salt and 1½ tbsp oil.");
  assert.equal(cleanAmountsInText("Add 1 tsp vanilla."), "Add 1 tsp vanilla.");
  // Under 50 ml reads better in spoons: 5 ml = 1 tsp, 15 ml = 1 tbsp.
  assert.equal(cleanAmountsInText("Heat 5 ml olive oil, then 30 ml soy sauce and 250 ml stock."), "Heat 1 tsp olive oil, then 2 tbsp soy sauce and 250 ml stock.");
});

test("spoons and pinches: same in both systems, scaled between tsp and tbsp", () => {
  const show = (amount, unit, system = "metric") => {
    const [ing] = convertUnitSystem([{ id: "x", name: "Salt", amount, base_unit: unit }], system);
    return ing.display;
  };
  assert.equal(show(1, "tsp"), "1 tsp Salt");
  assert.equal(show(1, "tsp", "imperial"), "1 tsp Salt");
  assert.equal(show(0.5, "tsp"), "½ tsp Salt");
  assert.equal(show(4.5, "tsp"), "1½ tbsp Salt");
  assert.equal(show(0.5, "tbsp"), "1½ tsp Salt");
  assert.equal(show(2, "pinch", "imperial"), "2 pinches Salt");
  assert.equal(show(4, "pinch"), "¼ tsp Salt"); // never more than 2 pinches
  assert.deepEqual(spoons(0.1, "tsp"), { amount: "¼", unit: "tsp" }); // never 0
  // Stored amounts are tidied the same way.
  assert.deepEqual(cleanSpoon(0.3, "tsp"), { amount: 0.25, unit: "tsp" });
  assert.deepEqual(cleanSpoon(6, "tsp"), { amount: 2, unit: "tbsp" });
  assert.deepEqual(cleanSpoon(0.5, "tbsp"), { amount: 1.5, unit: "tsp" });
  assert.deepEqual(cleanSpoon(14, "pinch"), { amount: 1, unit: "tsp" });
  assert.deepEqual(cleanSpoon(1, "pinch"), { amount: 1, unit: "pinch" });
});

test("a long step doesn't throw away the recipe", () => {
  const long = "Toss in the cooked noodles with 2 tbsp soy sauce, 1 tsp sesame oil, 1 tbsp oyster sauce, 100 g bean sprouts and 2 sliced spring onions, then stir-fry over high heat for 1 min until glossy.";
  assert.ok(long.length > 160);
  const made = toRecipe(
    {
      title: "Noodles",
      base_servings: 2,
      ingredients: [{ name: "Noodles", base_amount: 200, base_unit: "g", substitutes: [], optional: false }],
      steps: [{ title: "Toss", instruction: long, visual_cues: [], timer_sec: 60 }],
    },
    { recipe_id: "gen-noodles-x", origin: "generated", edits: [] },
  );
  assert.equal(made.steps.length, 1);
  // Long ingredient names and big batches are real recipes too.
  const batch = toRecipe(
    {
      title: "Chocolate Chip Cookies",
      base_servings: 24,
      ingredients: [
        { name: "Boneless skinless chicken breasts, cut into bite-sized pieces", base_amount: 500, base_unit: "g", substitutes: [], optional: false },
      ],
      steps: [{ title: "Bake", instruction: "Bake 10 min.", visual_cues: [], timer_sec: 600 }],
    },
    { recipe_id: "gen-batch-x", origin: "generated", edits: [] },
  );
  assert.equal(batch.base_servings, 24);
});

test("small liquid amounts are stored in spoons", () => {
  const ing = (base_amount) => ({ name: "Olive oil", base_amount, base_unit: "ml", substitutes: [], optional: false });
  const made = toRecipe(
    {
      title: "Dressing",
      base_servings: 2,
      ingredients: [ing(5), ing(10), ing(15), ing(45), ing(50)],
      steps: [{ title: "Mix", instruction: "Whisk 15 ml olive oil.", visual_cues: [], timer_sec: null }],
    },
    { recipe_id: "gen-dressing-x", origin: "generated", edits: [] },
  );
  assert.deepEqual(
    made.ingredients.map((i) => `${i.base_amount} ${i.base_unit}`),
    ["1 tsp", "2 tsp", "1 tbsp", "3 tbsp", "50 ml"],
  );
  assert.equal(made.steps[0].instruction, "Whisk 1 tbsp olive oil.");
});

test("AI recipes come out in Celsius", () => {
  const made = toRecipe(
    {
      title: "Cookies",
      base_servings: 12,
      ingredients: [{ name: "Water, warmed to 110°F", base_amount: 50, base_unit: "ml", substitutes: [], optional: false }],
      steps: [{ title: "Bake", instruction: "Bake at 375°F for 10 min.", visual_cues: ["Golden at 375°F"], timer_sec: 600 }],
    },
    { recipe_id: "gen-cookies-x", origin: "generated", edits: [] },
  );
  assert.equal(made.steps[0].instruction, "Bake at 190°C for 10 min.");
  assert.deepEqual(made.steps[0].visual_cues, ["Golden at 190°C"]);
  assert.equal(made.ingredients[0].name, "Water, warmed to 43°C");
});

test("a web recipe's source is the site Gemini names, only if it searched", () => {
  const queries = ["spaghetti carbonara recipe bbc good food"];
  assert.deepEqual(sourceOf(queries, "https://www.BBCGoodFood.com/recipes/x"), { name: "bbcgoodfood.com" });
  assert.equal(sourceOf([], "bbcgoodfood.com"), null); // no search: no source
  assert.equal(sourceOf(queries, ""), null);
  assert.equal(sourceOf(queries, "vertexaisearch.cloud.google.com"), null); // Google's link, not a site
  assert.equal(sourceOf(queries, "https://www.google.com/search?q=x"), null);
  // The source stays on the recipe through toRecipe (and so through edits).
  const source = { name: "bbcgoodfood.com" };
  const kept = toRecipe(recipeToDraft(recipe), { recipe_id: "gen-x", origin: "generated", edits: ["x"], source });
  assert.deepEqual(kept.source, source);
});

test("scaled metric amounts are tidy, small liquids in spoons (same as the app)", () => {
  const show = (amount, base_unit) => convertUnitSystem([{ id: "x", name: "X", amount, base_unit }], "metric")[0].display;
  assert.equal(show(27.5, "g"), "30 g X");
  assert.equal(show(56.7, "g"), "55 g X");
  assert.equal(show(125, "g"), "125 g X");
  assert.equal(show(30, "ml"), "2 tbsp X");
  assert.equal(show(480, "ml"), "480 ml X");
  assert.equal(show(1.5, "unit"), "1.5 X");
});

test("the cook's servings live on the recipe: kept through edits, used for answers", () => {
  const picked = { ...recipe, servings: 2 }; // the fixture is for 4
  const text = recipeContext(picked, undefined, picked.servings);
  assert.match(text, /making 2 servings/);
  assert.match(text, /- 125 g Plain flour/); // 250 g for 4
  assert.match(text, /Amounts in the steps are for 4 servings; scale them to 2/);
  assert.doesNotMatch(recipeContext(recipe, undefined, 4), /Amounts in the steps/);
  const edited = toRecipe(recipeToDraft(picked), { recipe_id: picked.recipe_id, origin: "generated", edits: ["x"], servings: picked.servings });
  assert.equal(edited.servings, 2);
  assert.equal(edited.base_servings, 4);
  assert.ok(AskRequestSchema.safeParse({ recipe: picked, question: "How much flour?" }).success);
});

test("generate request validation", () => {
  assert.ok(GenerateRequestSchema.safeParse({ request: "carbonara for 4" }).success);
  assert.equal(GenerateRequestSchema.safeParse({ request: "   " }).success, false);
  // Servings aren't part of a recipe request (the app scales); an old client's value is ignored.
  assert.deepEqual(GenerateRequestSchema.parse({ request: "lasagne", servings: 6 }), { request: "lasagne" });
});

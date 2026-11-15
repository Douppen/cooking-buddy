// Fast checks that need no server and no Gemini: `npm test` (node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanAmount, cleanAmountsInText, cleanCount, cleanSpoon, convertUnitSystem, scaleIngredients, spoons, toCelsiusInText } from "./scaling.js";
import { RecipeSchema, decodeEntities, toRecipe } from "./models/domain.js";
import { shoppingList } from "./phone.js";
import { AskRequestSchema } from "./ask.js";
import { GenerateRequestSchema } from "./generate.js";
import { HomeRequestSchema } from "./home.js";
import { NotFoodError, namedDish, sourceOf, toFound, toSorted } from "./ai/generate.js";
import { recipeContext, toAnswer, toTimer } from "./ai/answer.js";
import { generatedRecipeId, recipeToDraft } from "./ai/recipeFormat.js";
import { handoverLine, personaFor } from "./ai/personas.js";

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
  // The last exchange, so "yes, do it" makes the suggested change.
  const previous = { question: "Can I swap the butter?", answer: "Olive oil works: use 80 ml." };
  assert.ok(AskRequestSchema.safeParse({ recipe, question: "yes, do it", previous }).success);
  assert.equal(AskRequestSchema.safeParse({ recipe, question: "yes", previous: { question: "x" } }).success, false);
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
  assert.equal(show(1.5, "unit"), "1½ X");
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

test("whole counts (eggs, garlic cloves) never split; others round to halves", () => {
  const show = (amount, whole) =>
    convertUnitSystem([{ id: "x", name: "X", amount, base_unit: "unit", whole }], "metric")[0].display;
  assert.equal(show(0.3, true), "1 X"); // never 0.3 egg
  assert.equal(show(2.5, true), "3 X");
  assert.equal(show(0.3, false), "½ X"); // half a lime is fine
  assert.equal(show(1.6, false), "1½ X");
  assert.equal(cleanCount(0.25, true), 1);
  assert.equal(cleanCount(0.1, false), 0.5);
  // Eggs and garlic cloves are whole whatever the AI says; a lime is up to the AI.
  const made = toRecipe(
    {
      title: "Test",
      base_servings: 2,
      ingredients: [
        { name: "Large eggs", base_amount: 1.5, base_unit: "unit", substitutes: [], optional: false, whole: false },
        { name: "Garlic cloves, minced", base_amount: 0.5, base_unit: "unit", substitutes: [], optional: false, whole: false },
        { name: "Lime", base_amount: 0.3, base_unit: "unit", substitutes: [], optional: false, whole: false },
        { name: "Butter", base_amount: 30, base_unit: "g", substitutes: [], optional: false, whole: true },
      ],
      steps: [{ title: "Mix", instruction: "Mix.", visual_cues: [], timer_sec: null }],
    },
    { recipe_id: "gen-test-x", origin: "generated", edits: [] },
  );
  assert.deepEqual(
    made.ingredients.map((i) => [i.base_amount, i.whole]),
    [[2, true], [1, true], [0.5, false], [30, false]],
  );
});

test("home and generate request validation", () => {
  assert.ok(HomeRequestSchema.safeParse({ request: "carbonara for 4" }).success);
  assert.equal(HomeRequestSchema.safeParse({ request: "   " }).success, false);
  // The conversation so far on home, for follow-ups.
  const history = [{ role: "cook", text: "ideas for dinner?" }, { role: "buddy", text: "Try a curry or a stir-fry." }];
  assert.ok(HomeRequestSchema.safeParse({ request: "the second one", history }).success);
  assert.equal(HomeRequestSchema.safeParse({ request: "x", history: [{ role: "chef", text: "hi" }] }).success, false);
  // A recipe is fetched for a dish only; servings are the app's (it scales).
  assert.deepEqual(GenerateRequestSchema.parse({ dish: " lasagne ", servings: 6 }), { dish: "lasagne" });
  assert.equal(GenerateRequestSchema.safeParse({ dish: "" }).success, false);
});

test("the home box sorts replies: a named dish, an answer with suggestions, or not food", () => {
  const input = { request: "ideas", history: [] };
  const answer = toSorted(
    { dish: "", intent: "chat", answer: " Try a curry. ", suggestions: ["Chicken curry", " ", "Dal", "Stir-fry", "Pasta"] },
    input,
  );
  assert.deepEqual(answer, { kind: "answer", answer: "Try a curry.", suggestions: ["Chicken curry", "Dal", "Stir-fry"] });
  assert.throws(() => toSorted({ dish: "", intent: "not_food" }, input), NotFoodError);
  assert.throws(() => toSorted({ dish: "", intent: "chat", answer: "" }, input)); // no answer
  assert.deepEqual(toSorted({ dish: "Lasagna", intent: "recipe", servings: 0, cuisine: "italian" }, { request: "lasagna" }), {
    kind: "dish",
    dish: "Lasagna",
    servings: null,
    cuisine: "italian",
  });
  // What the cook says about servings comes along with the dish, within 1-8.
  assert.equal(toSorted({ dish: "Lasagna", intent: "recipe", servings: 4 }, { request: "lasagna for 4" }).servings, 4);
  assert.equal(toSorted({ dish: "Lasagna", intent: "recipe", servings: 30 }, { request: "lasagna for 30" }).servings, 8);
  assert.equal(toSorted({ dish: "Lasagna", intent: "recipe", servings: 2.5 }, { request: "lasagna" }).servings, 3);
  // A dish the cook never named: the answer instead.
  const vague = { request: "give me a simple middle eastern recipe" };
  const picked = { dish: "Shakshuka", intent: "recipe", answer: "Try shakshuka or falafel.", suggestions: ["Shakshuka", "Falafel"] };
  assert.equal(toSorted(picked, vague).kind, "answer");
  const found = toFound(recipeToDraft(recipe), "pancakes", { queries: ["pancakes recipe"], source: { name: "example.com" } });
  assert.equal(found.searched, true);
  assert.equal(found.recipe.source.name, "example.com");
  assert.equal(found.recipe.origin, "generated");
});

test("a dish counts only when the cook or an earlier suggestion named it", () => {
  const said = (request, ...buddy) => ({ request, history: buddy.map((text) => ({ role: "buddy", text })) });
  assert.ok(namedDish("Lasagna", said("lasagna")));
  assert.ok(namedDish("Lasagna", said("lasgna"))); // a typo
  assert.ok(namedDish("Classic Lasagna", said("lasagna")));
  assert.ok(namedDish("Spaghetti Carbonara", said("carbonara")));
  assert.ok(namedDish("chicken curry", said("I want to cook chicken curry")));
  assert.ok(namedDish("Banana bread", said("a recipe for banana bread")));
  assert.ok(namedDish("Crème brûlée", said("creme brulee")));
  assert.ok(namedDish("Shakshuka", said("the third one", "Try these. (Suggested: Falafel; Hummus; Shakshuka)")));
  assert.ok(!namedDish("Shakshuka", said("give me a simple midlde eastern recipe")));
  assert.ok(namedDish("Shakshuka", said("yes, let's do it", "How about shakshuka? (Suggested: Shakshuka)")));
  assert.ok(!namedDish("Pan Seared Chicken Breast", said("chicken recipe")));
  assert.ok(!namedDish("Easy Recipe", said("an easy recipe")));
});

test("a recipe change gets a standard answer, not Gemini's words", () => {
  const draft = recipeToDraft(recipe);
  assert.deepEqual(toAnswer({ change_summary: "swapped butter for olive oil.", answer: "", recipe: draft }), {
    answer: "Swapped butter for olive oil.",
    changeSummary: "swapped butter for olive oil",
    draft,
    servings: null,
    timer: null,
  });
  assert.equal(toAnswer({ change_summary: "Swapped butter for oil", answer: "Use oil now!", recipe: draft }).answer, "Swapped butter for oil.");
  assert.deepEqual(toAnswer({ change_summary: "", answer: " Fry for 3 minutes. " }), {
    answer: "Fry for 3 minutes.",
    changeSummary: "",
    draft: null,
    servings: null,
    timer: null,
  });
  assert.equal(toAnswer({ change_summary: "", answer: "Yes.", recipe: draft }).draft, null); // no summary: no change
  // "Make it for 6": new servings only, within 1-8.
  assert.deepEqual(toAnswer({ change_summary: "", servings: 6, answer: "" }), {
    answer: "Scaled to 6 servings.",
    changeSummary: "Scaled to 6 servings",
    draft: null,
    servings: 6,
    timer: null,
  });
  const capped = toAnswer({ change_summary: "Doubled to 12 servings", servings: 12, answer: "" });
  assert.equal(capped.servings, 8);
  assert.equal(capped.answer, "Scaled to 8 servings.");
  assert.equal(toAnswer({ change_summary: "", servings: 0, answer: "Fry it." }).servings, null);
  assert.throws(() => toAnswer({ change_summary: "", answer: "" }));
});

test("HTML entities copied from a web page are decoded", () => {
  assert.equal(decodeEntities("Add &#189; tsp ground nutmeg &amp; salt."), "Add ½ tsp ground nutmeg & salt.");
  assert.equal(decodeEntities("Bake at 180&deg;C, &frac14; cup, &#xBD; lemon, &nbsp;ok"), "Bake at 180°C, ¼ cup, ½ lemon,  ok");
  assert.equal(decodeEntities("Salt & pepper; &unknown; stays"), "Salt & pepper; &unknown; stays");
  const draft = recipeToDraft(recipe);
  draft.steps[0].instruction = "Add &#189; tsp ground nutmeg. Simmer 5 min.";
  const tidied = toRecipe(draft, { recipe_id: "x", origin: "generated", edits: [] });
  assert.equal(tidied.steps[0].instruction, "Add ½ tsp ground nutmeg. Simmer 5 min.");
});

test("timers the cook asks for", () => {
  assert.deepEqual(toTimer({ action: "start", minutes: 10, label: "pasta" }), { action: "start", seconds: 600, label: "Pasta" });
  assert.deepEqual(toTimer({ action: "start", minutes: 0.5, label: "" }), { action: "start", seconds: 30, label: "Timer" });
  assert.equal(toTimer({ action: "start", minutes: 0, label: "x" }), null);
  assert.equal(toTimer({ action: "start", minutes: 9999, label: "Stew" }).seconds, 12 * 3600);
  assert.deepEqual(toTimer({ action: "cancel", label: "" }), { action: "cancel", label: "" });
  assert.equal(toTimer({ action: "none" }), null);
  assert.equal(toTimer(undefined), null);
  const set = toAnswer({ change_summary: "", servings: 0, timer: { action: "start", minutes: 10, label: "Pasta" }, answer: "OK" });
  assert.equal(set.answer, "Pasta timer: 10 min.");
  assert.deepEqual(set.timer, { action: "start", seconds: 600, label: "Pasta" });
  assert.equal(toAnswer({ change_summary: "", servings: 0, timer: { action: "cancel", label: "" }, answer: "" }).answer, "Timers stopped.");
  const plain = toAnswer({ change_summary: "", servings: 0, timer: { action: "start", minutes: 1.5, label: "" }, answer: "" });
  assert.equal(plain.answer, "Timer: 1 min 30 s.");
});

test("each recipe's cuisine picks its cook; home and other cuisines keep the British chef", () => {
  assert.equal(personaFor("indian", "Butter Chicken"), "indian");
  assert.equal(personaFor("chinese"), "chinese");
  assert.equal(personaFor("other", "Spaghetti Carbonara"), "chef"); // the cuisine wins over the title
  assert.equal(personaFor(undefined), "chef"); // home sends no cuisine
  // Older recipes without a cuisine: an Italian title still gets Giuseppe; shared ingredients don't count.
  assert.equal(personaFor(null, "Spaghetti Carbonara"), "italian");
  assert.equal(personaFor(null, "Caesar Salad with parmesan"), "chef");
  assert.equal(
    handoverLine("butter chicken", "indian"),
    "Alright, here's your butter chicken recipe. Now let me hand you over to my expert colleague, Pankaj. " +
      "This dish is his specialty.",
  );
  assert.equal(handoverLine("moussaka", "other"), "Alright, here's your moussaka recipe. Let's get cooking!");
  assert.match(handoverLine("pierogi", "eastern_european"), /colleague, Babushka Olga\. This dish is her specialty\.$/);
  assert.match(handoverLine("BBQ ribs", "american"), /colleague, Bubba\. This dish is his specialty\.$/);
});

test("the home box names a dish's cuisine; an unknown one is other", () => {
  const input = { request: "butter chicken for 4", history: [] };
  assert.deepEqual(toSorted({ intent: "recipe", dish: "butter chicken", servings: 4, cuisine: "indian" }, input), {
    kind: "dish",
    dish: "butter chicken",
    servings: 4,
    cuisine: "indian",
  });
  assert.equal(toSorted({ intent: "recipe", dish: "butter chicken", cuisine: "martian" }, input).cuisine, "other");
});

test("the shopping list for the phone: scaled, in the cook's units", () => {
  const list = shoppingList(recipe, 2, "metric");
  assert.equal(list.title, "Buttermilk Pancakes, 2 servings");
  assert.match(list.message, /^• 125 g Plain flour$/m);
  assert.match(list.message, /^• 15 g Butter, melted$/m);
  assert.match(shoppingList(recipe, 4, "imperial").message, /^• 2 cups Buttermilk$/m);
  const ask = toAnswer({ change_summary: "", servings: 0, timer: { action: "none" }, send_list: true, answer: "" });
  assert.equal(ask.sendList, true);
});

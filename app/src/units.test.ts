// `npm test` in app/: node's test runner, which runs TypeScript directly (Node 24 strips
// the types). Not part of the typecheck (see tsconfig.json), so it needs no Node types.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countWords, inUnitSystem, measureText, scaleAmountsInText} from './units.ts';

test('metric amounts are shown as stored', () => {
  assert.equal(measureText(250, 'g', 'metric'), '250 g');
  assert.equal(measureText(12.345, 'ml', 'metric'), '2½ tsp'); // under 50 ml: spoons
  assert.equal(measureText(480, 'ml', 'metric'), '480 ml');
  assert.equal(measureText(2, 'unit', 'metric'), '2');
  assert.equal(inUnitSystem('Bake at 200°C for 25 min.', 'metric'), 'Bake at 200°C for 25 min.');
});

test('imperial weights: oz, then lb', () => {
  assert.equal(measureText(250, 'g', 'imperial'), '8.8 oz');
  assert.equal(measureText(300, 'g', 'imperial'), '11 oz');
  assert.equal(measureText(1, 'g', 'imperial'), '0.1 oz');
  assert.equal(measureText(450, 'g', 'imperial'), '1 lb');
  assert.equal(measureText(1000, 'g', 'imperial'), '2.2 lb');
});

test('imperial volumes: tsp, tbsp, then cups', () => {
  assert.equal(measureText(1, 'ml', 'imperial'), '¼ tsp');
  assert.equal(measureText(5, 'ml', 'imperial'), '1 tsp');
  assert.equal(measureText(10, 'ml', 'imperial'), '2 tsp');
  assert.equal(measureText(15, 'ml', 'imperial'), '1 tbsp');
  assert.equal(measureText(30, 'ml', 'imperial'), '2 tbsp');
  assert.equal(measureText(60, 'ml', 'imperial'), '¼ cup');
  assert.equal(measureText(80, 'ml', 'imperial'), '⅓ cup');
  assert.equal(measureText(150, 'ml', 'imperial'), '⅔ cup');
  assert.equal(measureText(250, 'ml', 'imperial'), '1 cup');
  assert.equal(measureText(300, 'ml', 'imperial'), '1¼ cups');
  assert.equal(measureText(480, 'ml', 'imperial'), '2 cups');
  assert.equal(measureText(1000, 'ml', 'imperial'), '4¼ cups');
});

test('counts stay counts', () => {
  assert.equal(measureText(2, 'unit', 'imperial'), '2');
  assert.equal(measureText(0.5, 'unit', 'imperial'), '0.5');
});

test('step text: temperatures, amounts and lengths', () => {
  assert.equal(inUnitSystem('Bake at 200°C (180°C fan).', 'imperial'), 'Bake at 400°F (350°F fan).');
  assert.equal(inUnitSystem('Heat oil to 175 °C.', 'imperial'), 'Heat oil to 350°F.');
  assert.equal(inUnitSystem('Cook until it reads 63°C inside.', 'imperial'), 'Cook until it reads 145°F inside.');
  assert.equal(inUnitSystem('Keep at 75-80 degrees Celsius.', 'imperial'), 'Keep at 167–176°F.');
  assert.equal(inUnitSystem('Add 100 ml of the milk and 50 g sugar.', 'imperial'), 'Add ½ cup of the milk and 1.8 oz sugar.');
  assert.equal(inUnitSystem('Pour in 1,5 dl cream.', 'imperial'), 'Pour in ⅔ cup cream.');
  assert.equal(inUnitSystem('Boil 2 l salted water.', 'imperial'), 'Boil 8½ cups salted water.');
  assert.equal(inUnitSystem('Cut into 2 cm cubes, 5 mm thick.', 'imperial'), 'Cut into ¾ in cubes, ¼ in thick.');
  assert.equal(inUnitSystem('Use a 23 cm tin.', 'imperial'), 'Use a 9 in tin.');
  assert.equal(inUnitSystem('Slice 2-3 cm thick.', 'imperial'), 'Slice ¾–1¼ in thick.');
});

test('step text: leaves other words and numbers alone', () => {
  const text = 'Add 2 large eggs, 3 garlic cloves and 1 lime; cook 20 to 25 min.';
  assert.equal(inUnitSystem(text, 'imperial'), text);
  assert.equal(inUnitSystem('Weigh out 1,000 g.', 'imperial'), 'Weigh out 1,000 g.');
});

test('spoons and pinches look the same in both systems', () => {
  for (const system of ['metric', 'imperial'] as const) {
    assert.equal(measureText(1, 'tsp', system), '1 tsp');
    assert.equal(measureText(0.5, 'tsp', system), '½ tsp');
    assert.equal(measureText(1.5, 'tbsp', system), '1½ tbsp');
    assert.equal(measureText(1, 'pinch', system), '1 pinch');
    assert.equal(measureText(2, 'pinch', system), '2 pinches');
  }
});

test('scaled spoons move between tsp and tbsp; more than 2 pinches become tsp', () => {
  assert.equal(measureText(0.1, 'tsp', 'metric'), '¼ tsp'); // never 0
  assert.equal(measureText(3, 'tsp', 'metric'), '1 tbsp');
  assert.equal(measureText(4.5, 'tsp', 'metric'), '1½ tbsp');
  assert.equal(measureText(0.5, 'tbsp', 'metric'), '1½ tsp');
  assert.equal(measureText(0.5, 'pinch', 'metric'), '1 pinch');
  assert.equal(measureText(4, 'pinch', 'metric'), '¼ tsp');
  assert.equal(measureText(8, 'pinch', 'metric'), '½ tsp');
});

test('scaled metric amounts are tidy, small liquids in spoons', () => {
  assert.equal(measureText(27.5, 'g', 'metric'), '30 g'); // 55 g for half the servings
  assert.equal(measureText(56.7, 'g', 'metric'), '55 g');
  assert.equal(measureText(1.4, 'g', 'metric'), '1.5 g');
  assert.equal(measureText(125, 'g', 'metric'), '125 g');
  assert.equal(measureText(30, 'ml', 'metric'), '2 tbsp');
  assert.equal(measureText(5, 'ml', 'metric'), '1 tsp');
  assert.equal(measureText(60, 'ml', 'metric'), '60 ml');
  assert.equal(measureText(1.5, 'unit', 'metric'), '1.5');
});

test('step text scales amounts and counted ingredients, not times or sizes', () => {
  const counted = countWords([
    {name: 'Large eggs', base_unit: 'unit'},
    {name: 'Garlic cloves, minced', base_unit: 'unit'},
    {name: 'Butter', base_unit: 'g'},
  ]);
  const scale = (text: string, factor: number) => scaleAmountsInText(text, factor, counted);
  assert.equal(scale('Beat 140 g butter with 2 large eggs for 2 min.', 0.5), 'Beat 70 g butter with 1 large eggs for 2 min.');
  assert.equal(scale('Fry 3 garlic cloves in 2 tbsp oil at 180°C for 10 min.', 2), 'Fry 6 garlic cloves in 4 tbsp oil at 180°C for 10 min.');
  assert.equal(scale('Add ½ tsp salt and 1½ tbsp sugar.', 2), 'Add 1 tsp salt and 3 tbsp sugar.');
  assert.equal(scale('Pour in 300 ml stock, then 15 ml soy sauce.', 0.5), 'Pour in 150 ml stock, then 1½ tsp soy sauce.');
  assert.equal(scale('Add 150–200 g flour.', 2), 'Add 300–400 g flour.');
  assert.equal(scale('Cut into 2 cm cubes and rest 5 minutes.', 3), 'Cut into 2 cm cubes and rest 5 minutes.');
  assert.equal(scale('A pinch of salt, 1 pinch pepper.', 4), 'A pinch of salt, ¼ tsp pepper.');
  assert.equal(scale('Beat 140 g butter.', 1), 'Beat 140 g butter.');
});

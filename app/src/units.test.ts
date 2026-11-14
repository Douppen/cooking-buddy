// `npm test` in app/: node's test runner, which runs TypeScript directly (Node 24 strips
// the types). Not part of the typecheck (see tsconfig.json), so it needs no Node types.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inUnitSystem, measureText} from './units.ts';

test('metric amounts are shown as stored', () => {
  assert.equal(measureText(250, 'g', 'metric'), '250 g');
  assert.equal(measureText(12.345, 'ml', 'metric'), '12.3 ml');
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

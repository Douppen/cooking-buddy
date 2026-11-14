// Scaling recipes to a number of servings and showing amounts in metric or imperial units.
// Pure functions, no I/O: the native app's version can follow this line by line.
//
//   convertUnitSystem(scaleIngredients(recipe.ingredients, servings / recipe.base_servings), "imperial")
//   → [{ id, name, amount: "8.8", unit: "oz", display: "8.8 oz Plain flour" }, ...]
//
// The app shows amounts with the same rules (measure() in app/src/units.ts), so the AI
// answers with the amounts the cook sees. Change both together.

/**
 * Scales each ingredient's base_amount by `factor`, adding an `amount` field.
 * @param {Array<{base_amount: number}>} ingredients
 * @param {number} factor  target servings / base servings
 */
export function scaleIngredients(ingredients, factor) {
  return ingredients.map((ing) => ({ ...ing, amount: ing.base_amount * factor }));
}

/**
 * Converts scaled ingredients (from scaleIngredients) to display amounts in the chosen
 * unit system. Metric is shown as stored, to one decimal. Imperial: grams become oz (lb
 * from about 1 lb up); millilitres become tsp below 1 tbsp, tbsp below ¼ cup, then cups,
 * in the fractions a measuring set has. Counts (eggs, cloves) never change.
 * @param {Array<{id: string, name: string, amount: number, base_unit: 'g'|'ml'|'unit'}>} scaled
 * @param {'metric'|'imperial'} unitSystem
 * @returns {Array<{id: string, name: string, amount: string, unit: string, display: string}>}
 *   amount as shown ("1¼"); unit is "" for counts
 */
export function convertUnitSystem(scaled, unitSystem) {
  return scaled.map((ing) => {
    const { amount, unit } = toUnitSystem(ing.amount, ing.base_unit, unitSystem);
    const display = unit ? `${amount} ${unit} ${ing.name}` : `${amount} ${ing.name}`;
    return { id: ing.id, name: ing.name, amount, unit, display };
  });
}

const G_PER_OZ = 28.3495;
const ML_PER_TSP = 4.92892;
const ML_PER_TBSP = 14.7868;
const ML_PER_CUP = 236.588;

// [value, glyph]; 0 and 1 have none.
const QUARTERS = [[0, ""], [1 / 4, "¼"], [1 / 2, "½"], [3 / 4, "¾"], [1, ""]];
const CUP_FRACTIONS = [[0, ""], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"], [1, ""]];
const HALVES = [[0, ""], [1 / 2, "½"], [1, ""]];

function toUnitSystem(qty, baseUnit, unitSystem) {
  if (unitSystem !== "imperial" || baseUnit === "unit") {
    return { amount: decimal(qty, 1), unit: baseUnit === "unit" ? "" : baseUnit };
  }
  if (baseUnit === "g") {
    const oz = qty / G_PER_OZ;
    if (oz >= 15.5) return { amount: decimal(oz / 16, 1), unit: "lb" };
    return { amount: oz >= 10 ? decimal(oz, 0) : decimal(Math.max(oz, 0.1), 1), unit: "oz" };
  }
  const tsp = qty / ML_PER_TSP;
  if (tsp < 2.875) return { amount: fraction(tsp, QUARTERS), unit: "tsp" };
  const tbsp = qty / ML_PER_TBSP;
  if (tbsp < 3.75) return { amount: fraction(tbsp, HALVES), unit: "tbsp" };
  const cups = qty / ML_PER_CUP;
  return { amount: fraction(cups, cups < 4 ? CUP_FRACTIONS : QUARTERS), unit: cups < 1.125 ? "cup" : "cups" };
}

function decimal(n, digits) {
  return String(Number(n.toFixed(digits)));
}

// --- Temperatures in text -----------------------------------------------------------------
// Recipes store temperatures in the step text, always in Celsius ("Bake at 180°C"); the app
// shows them in °F for imperial (inUnitSystem() in app/src/units.ts). Web recipes are often
// in °F or gas marks, and the AI doesn't always convert, so toRecipe() runs every AI-written
// recipe through toCelsiusInText(). It writes "180°C", the form the app's converter reads.

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const FAHRENHEIT_IN_TEXT = new RegExp(
  String.raw`(?<![\d.,])(${NUMBER})(?:\s*(?:-|–|to)\s*(${NUMBER}))?\s*` +
    String.raw`(?:[°º]\s*F\b|[Dd]egrees?\s+(?:F\b|[Ff]ahrenheit\b)|[Ff]ahrenheit\b|F\b)`,
  "g",
);
const GAS_MARK = /\bgas mark\s*(\d)\b/gi;
const GAS_MARK_CELSIUS = { 1: 140, 2: 150, 3: 170, 4: 180, 5: 190, 6: 200, 7: 220, 8: 230, 9: 240 };

// A Celsius temperature the AI wrote, to tidy: "177°C", "177 degrees C/Celsius".
const CELSIUS_IN_TEXT = new RegExp(
  String.raw`(?<![\d.,])(${NUMBER})\s*(?:[°º]\s*C\b|[Dd]egrees?\s+(?:C\b|[Cc]elsius\b))`,
  "g",
);

/**
 * "Bake at 350°F" → "Bake at 180°C", "375 degrees F" → "190°C", "gas mark 6" → "200°C".
 * Oven temperatures (250°F and up) round to the nearest 10°C like an oven dial; lower ones
 * (a meat's core temperature) to the degree: "145°F" → "63°C". Celsius oven temperatures
 * that an exact conversion left uneven are rounded to the nearest 5: "177°C" → "175°C".
 */
export function toCelsiusInText(text) {
  return text
    .replace(FAHRENHEIT_IN_TEXT, (_match, first, second) => {
      const values = second === undefined ? [first] : [first, second];
      return `${values.map((f) => celsius(Number(f))).join("–")}°C`;
    })
    .replace(GAS_MARK, (match, mark) => (GAS_MARK_CELSIUS[mark] ? `${GAS_MARK_CELSIUS[mark]}°C` : match))
    .replace(CELSIUS_IN_TEXT, (match, value) => {
      const c = Number(value);
      return c >= 100 && c % 5 !== 0 ? `${Math.round(c / 5) * 5}°C` : match;
    });
}

function celsius(fahrenheit) {
  const c = ((fahrenheit - 32) * 5) / 9;
  return fahrenheit >= 250 ? Math.round(c / 10) * 10 : Math.round(c);
}

// "1¼", "⅔", "3": the nearest fraction from the set, never "0" (the smallest one instead).
function fraction(value, fractions) {
  let whole = Math.floor(value);
  const rest = value - whole;
  let [part, glyph] = fractions[0];
  for (const candidate of fractions) {
    if (Math.abs(candidate[0] - rest) < Math.abs(part - rest)) [part, glyph] = candidate;
  }
  if (part === 1) whole += 1;
  if (whole === 0 && !glyph) return fractions[1][1];
  return `${whole || ""}${glyph}`;
}

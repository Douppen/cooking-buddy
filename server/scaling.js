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
 * Spoons and pinches look the same in both systems (see spoons()).
 * @param {Array<{id: string, name: string, amount: number, base_unit: string}>} scaled
 *   base_unit: 'g' | 'ml' | 'unit' | 'tsp' | 'tbsp' | 'pinch'
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
  if (SPOON_UNITS.has(baseUnit)) return spoons(qty, baseUnit);
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

// --- Spoons and pinches -------------------------------------------------------------------
// Small amounts of salt, spices, leaveners and extracts are kept in spoons, as recipes
// write them, and look the same in metric and imperial. Same rules as spoons() in
// app/src/units.ts: change both together.

const SPOON_UNITS = new Set(["tsp", "tbsp", "pinch"]);

/** As a number of teaspoons, before rounding: 3 tsp to the tbsp, 16 pinches to the tsp. */
function inTsp(amount, unit) {
  return unit === "tbsp" ? amount * 3 : unit === "pinch" ? amount / 16 : amount;
}

/**
 * A spoon amount as shown: tsp in quarters, tbsp in halves, 3 tsp or more as tbsp, under
 * 1 tbsp as tsp. A pinch is only ever 1 or 2; more becomes tsp. Never 0.
 * @returns {{ amount: string, unit: string }}  e.g. { amount: "1½", unit: "tbsp" }
 */
export function spoons(amount, unit) {
  if (unit === "pinch" && amount <= 2.5) {
    const pinches = Math.max(1, Math.round(amount));
    return { amount: String(pinches), unit: pinches === 1 ? "pinch" : "pinches" };
  }
  const tsp = inTsp(amount, unit);
  if (tsp < 2.875) return { amount: fraction(tsp, QUARTERS), unit: "tsp" };
  return { amount: fraction(tsp / 3, HALVES), unit: "tbsp" };
}

/**
 * A stored spoon amount, tidied by the same rules: { 0.3, "tsp" } → { 0.25, "tsp" },
 * { 4, "pinch" } → { 0.25, "tsp" }, { 0.5, "tbsp" } → { 1.5, "tsp" }, { 6, "tsp" } → { 2, "tbsp" }.
 */
export function cleanSpoon(amount, unit) {
  if (unit === "pinch" && amount <= 2.5) return { amount: Math.max(1, Math.round(amount)), unit };
  const tsp = inTsp(amount, unit);
  if (tsp < 2.875) return { amount: Math.max(Math.round(tsp * 4) / 4, 0.25), unit: "tsp" };
  return { amount: Math.round((tsp / 3) * 2) / 2, unit: "tbsp" };
}

// --- Clean amounts ------------------------------------------------------------------------
// Web recipes in cups and ounces come out of an exact conversion as "113 g" or "19 g".
// toRecipe() stores every AI recipe's g/ml amounts as a recipe writer would write them.

/**
 * A g or ml amount rounded the way recipes write them: under 5 to the half, 5–10 to the
 * whole, 10–100 to 5, 100–1000 to 10, above that to 50. Multiples of 25 (125, 175, 1250) are
 * already clean and stay. 113 → 110, 56 → 55, 19 → 20, 7.3 → 7, 1.2 → 1, 480 → 480.
 */
export function cleanAmount(amount) {
  if (amount >= 100 && amount % 25 === 0) return amount;
  const step = amount < 5 ? 0.5 : amount < 10 ? 1 : amount < 100 ? 5 : amount < 1000 ? 10 : 50;
  return Math.max(Math.round(amount / step) * step, step);
}

// "56 g", "113ml", "1.5 g" in step text.
const AMOUNT_IN_TEXT = new RegExp(String.raw`(?<![\d.,])(${String.raw`\d+(?:\.\d+)?`})(\s*)(g|ml)\b`, "g");

/** Step text with the same clean amounts as the ingredient list: "Add 56 g butter" → "Add 55 g butter". */
export function cleanAmountsInText(text) {
  return text.replace(AMOUNT_IN_TEXT, (_match, value, space, unit) => `${cleanAmount(Number(value))}${space}${unit}`);
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

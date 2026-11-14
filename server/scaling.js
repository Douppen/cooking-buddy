// Scaling recipes to a number of servings and showing amounts in metric or imperial units.
// Pure functions, no I/O: the native app's version can follow this line by line.
//
//   convertUnitSystem(scaleIngredients(recipe.ingredients, servings / recipe.base_servings), "metric")
//   → [{ id, name, amount, unit, display: "125 g Plain flour" }, ...]

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
 * unit system, with practical cooking rounding: oz/lbs for grams, fl oz/cups for
 * millilitres, counts (eggs, cloves) unchanged.
 * @param {Array<{id: string, name: string, amount: number, base_unit: 'g'|'ml'|'unit'}>} scaled
 * @param {'metric'|'imperial'} unitSystem
 * @returns {Array<{id: string, name: string, amount: number, unit: string, display: string}>}
 */
export function convertUnitSystem(scaled, unitSystem) {
  return scaled.map((ing) => {
    const { amount, unit } = toUnitSystem(ing.amount, ing.base_unit, unitSystem);
    const display = unit === "unit" ? `${amount} ${ing.name}` : `${amount} ${unit} ${ing.name}`;
    return { id: ing.id, name: ing.name, amount, unit, display };
  });
}

function toUnitSystem(qty, baseUnit, unitSystem) {
  if (unitSystem === "imperial" && baseUnit === "g") {
    const oz = qty * 0.035274;
    return oz >= 16 ? { amount: round(oz / 16, 2), unit: "lbs" } : { amount: round(oz, 1), unit: "oz" };
  }
  if (unitSystem === "imperial" && baseUnit === "ml") {
    const flOz = qty * 0.033814;
    return flOz >= 8 ? { amount: round(flOz / 8, 2), unit: "cups" } : { amount: round(flOz, 1), unit: "fl oz" };
  }
  // Metric, or a discrete count in either system.
  return { amount: round(qty, 1), unit: baseUnit };
}

function round(n, digits) {
  return Number.isInteger(n) ? n : Number(n.toFixed(digits));
}

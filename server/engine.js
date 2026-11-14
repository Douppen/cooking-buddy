/**
 * server/engine.js - Deterministic recipe execution & formatting engine.
 */

import { RecipeSchema, HudSyncMessageSchema } from "./models/index.js";

export class RecipeEngine {
  /**
   * @param {import("./models/domain.js").Recipe} recipe
   * @param {number} [initialServings]
   */
  constructor(recipe, initialServings) {
    this.recipe = RecipeSchema.parse(recipe);
    this.targetServings = initialServings ?? this.recipe.base_servings;
    this.unitSystem = "metric"; // 'metric' | 'imperial'
    this.activeStepIndex = 0;
  }

  get scaleFactor() {
    return this.targetServings / this.recipe.base_servings;
  }

  // Whole servings only: the HUD state (HudSyncMessageSchema) requires an integer, so a
  // fractional value would make getHudState() throw.
  setServings(servings) {
    if (Number.isInteger(servings) && servings > 0) {
      this.targetServings = servings;
    }
  }

  toggleUnits() {
    this.unitSystem = this.unitSystem === "metric" ? "imperial" : "metric";
  }

  nextStep() {
    if (this.activeStepIndex < this.recipe.steps.length - 1) {
      this.activeStepIndex += 1;
    }
  }

  prevStep() {
    if (this.activeStepIndex > 0) {
      this.activeStepIndex -= 1;
    }
  }

  goToStep(index) {
    if (index >= 0 && index < this.recipe.steps.length) {
      this.activeStepIndex = index;
    }
  }

  /**
   * Formats an ingredient based on the active scale and unit system.
   */
  formatIngredient(ing) {
    return convertUnitSystem(
      scaleIngredients([ing], this.scaleFactor),
      this.unitSystem,
    )[0].display;
  }

  /**
   * Produces the validated HUD synchronization payload.
   */
  getHudState() {
    const rawState = {
      t: "hud_sync",
      recipe_title: this.recipe.title,
      target_servings: this.targetServings,
      unit_system: this.unitSystem,
      active_step_index: this.activeStepIndex,
      total_steps: this.recipe.steps.length,
      current_step: this.recipe.steps[this.activeStepIndex],
      display_ingredients: this.recipe.ingredients.map((ing) =>
        this.formatIngredient(ing),
      ),
    };

    return HudSyncMessageSchema.parse(rawState);
  }
}

// --- Pure helpers (also used by session.js) ---------------------------------------------

/**
 * Scales each ingredient's base_amount by `factor`, adding an `amount` field.
 * @param {Array<{base_amount: number}>} ingredients
 * @param {number} factor
 */
export function scaleIngredients(ingredients, factor) {
  return ingredients.map((ing) => ({ ...ing, amount: ing.base_amount * factor }));
}

/**
 * Converts scaled ingredients (from scaleIngredients) to display amounts in the chosen
 * unit system, with practical cooking rounding.
 * @param {Array<{id: string, name: string, amount: number, base_unit: 'g'|'ml'|'unit'}>} scaled
 * @param {'metric'|'imperial'} unitSystem
 * @returns {Array<{id: string, name: string, amount: number, unit: string, display: string}>}
 */
export function convertUnitSystem(scaled, unitSystem) {
  return scaled.map((ing) => {
    const { amount, unit } = toUnitSystem(ing.amount, ing.base_unit, unitSystem);
    const display =
      unit === "unit" ? `${amount} ${ing.name}` : `${amount} ${unit} ${ing.name}`;
    return { id: ing.id, name: ing.name, amount, unit, display };
  });
}

function toUnitSystem(qty, baseUnit, unitSystem) {
  if (unitSystem === "imperial" && baseUnit === "g") {
    const oz = qty * 0.035274;
    return oz >= 16
      ? { amount: round(oz / 16, 2), unit: "lbs" }
      : { amount: round(oz, 1), unit: "oz" };
  }
  if (unitSystem === "imperial" && baseUnit === "ml") {
    const flOz = qty * 0.033814;
    return flOz >= 8
      ? { amount: round(flOz / 8, 2), unit: "cups" }
      : { amount: round(flOz, 1), unit: "fl oz" };
  }
  // Metric, or a discrete count (eggs, cloves) in either system.
  return { amount: round(qty, 1), unit: baseUnit };
}

function round(n, digits) {
  return Number.isInteger(n) ? n : Number(n.toFixed(digits));
}

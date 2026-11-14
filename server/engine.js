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

  setServings(servings) {
    if (servings > 0) {
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
    const scaledQty = ing.base_amount * this.scaleFactor;

    if (this.unitSystem === "metric") {
      const rounded = Number.isInteger(scaledQty)
        ? scaledQty
        : Number(scaledQty.toFixed(1));
      return `${rounded} ${ing.base_unit} ${ing.name}`;
    }

    // Imperial conversion
    if (ing.base_unit === "g") {
      const oz = scaledQty * 0.035274;
      if (oz >= 16) {
        return `${Number((oz / 16).toFixed(2))} lbs ${ing.name}`;
      }
      return `${Number(oz.toFixed(1))} oz ${ing.name}`;
    }

    if (ing.base_unit === "ml") {
      const flOz = scaledQty * 0.033814;
      if (flOz >= 8) {
        return `${Number((flOz / 8).toFixed(2))} cups ${ing.name}`;
      }
      return `${Number(flOz.toFixed(1))} fl oz ${ing.name}`;
    }

    // Discrete count items (e.g., eggs, cloves)
    const rounded = Number.isInteger(scaledQty)
      ? scaledQty
      : Number(scaledQty.toFixed(1));
    return `${rounded} ${ing.name}`;
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

export { RecipeEngine };

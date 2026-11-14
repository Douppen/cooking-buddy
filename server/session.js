/**
 * @file session.js
 * @description In-memory runtime session manager for CookbookOS.
 *
 * Coordinates live recipe execution between the Meta Glasses client and backend services:
 * - Stores ephemeral session state (active step, scale factor, unit preferences).
 * - Exposes reactive state hydration (via engine.js conversions) for the HUD view.
 * - Handles step navigation and debounced VLM completion auto-advance.
 * - Implements a pub/sub event mechanism to broadcast mutations over WebSockets/SSE.
 */

import crypto from "node:crypto";
import { scaleIngredients, convertUnitSystem } from "./engine.js";
import { RecipeSchema } from "./models/domain.js";

export class RecipeSession {
  /**
   * @param {Object} params
   * @param {string} params.id
   * @param {Object} params.recipe - Raw or parsed recipe matching RecipeSchema
   * @param {'metric'|'imperial'} [params.unitSystem='metric']
   * @param {number} [params.scaleFactor=1.0]
   */
  constructor({ id, recipe, unitSystem = "metric", scaleFactor = 1.0 }) {
    this.id = id;
    this.recipe = RecipeSchema.parse(recipe);
    this.currentStepIndex = 0;
    this.scaleFactor = Math.max(0.1, Number(scaleFactor) || 1.0);
    this.unitSystem = unitSystem === "imperial" ? "imperial" : "metric";
    this.completedSteps = new Set();
    this.vlmHistory = [];
    this.subscribers = new Set();
    this.updatedAt = Date.now();
  }

  /**
   * Generates the real-time hydrated state formatted for the Meta Glasses HUD.
   */
  getView() {
    const scaled = scaleIngredients(this.recipe.ingredients, this.scaleFactor);
    const converted = convertUnitSystem(scaled, this.unitSystem);

    const isFinished = this.currentStepIndex >= this.recipe.steps.length;
    const currentStep = !isFinished
      ? this.recipe.steps[this.currentStepIndex]
      : null;

    return {
      sessionId: this.id,
      recipeName: this.recipe.recipe_name,
      servings: Number((this.recipe.servings * this.scaleFactor).toFixed(2)),
      scaleFactor: Number(this.scaleFactor.toFixed(2)),
      unitSystem: this.unitSystem,
      currentStepIndex: this.currentStepIndex,
      currentStep,
      totalSteps: this.recipe.steps.length,
      ingredients: converted,
      completedStepIndices: Array.from(this.completedSteps),
      isFinished,
      updatedAt: this.updatedAt,
    };
  }

  // Navigation
  setStep(index) {
    const target = Number(index);
    if (
      !Number.isInteger(target) ||
      target < 0 ||
      target >= this.recipe.steps.length
    ) {
      return false;
    }
    this.currentStepIndex = target;
    this.touch();
    return true;
  }

  nextStep() {
    if (this.currentStepIndex < this.recipe.steps.length - 1) {
      this.completedSteps.add(this.currentStepIndex);
      this.currentStepIndex += 1;
      this.touch();
      return true;
    }
    if (this.currentStepIndex === this.recipe.steps.length - 1) {
      this.completedSteps.add(this.currentStepIndex);
      this.currentStepIndex += 1;
      this.touch();
      return true;
    }
    return false;
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex -= 1;
      this.touch();
      return true;
    }
    return false;
  }

  // Runtime Controls
  setScale(factor) {
    const parsed = Number(factor);
    if (parsed > 0 && Number.isFinite(parsed)) {
      this.scaleFactor = parsed;
      this.touch();
      return true;
    }
    return false;
  }

  setUnitSystem(system) {
    if (system === "metric" || system === "imperial") {
      this.unitSystem = system;
      this.touch();
      return true;
    }
    return false;
  }

  /**
   * Records a VLM phase prediction and auto-advances if confidence criteria are met.
   * Debounce: Requires 2 consecutive frames meeting confidence >= 0.8 on the current step.
   *
   * @param {Object} prediction
   * @param {boolean} prediction.completed
   * @param {number} prediction.confidence
   * @param {string} [prediction.rationale]
   * @returns {{ advanced: boolean, view: Object }}
   */
  recordVlmResult({ completed, confidence, rationale = "" }) {
    this.vlmHistory.push({
      timestamp: Date.now(),
      stepIndex: this.currentStepIndex,
      completed: Boolean(completed),
      confidence: Number(confidence) || 0,
      rationale,
    });

    const recent = this.vlmHistory
      .filter((entry) => entry.stepIndex === this.currentStepIndex)
      .slice(-2);

    const shouldAutoAdvance =
      recent.length === 2 &&
      recent.every((entry) => entry.completed && entry.confidence >= 0.8);

    if (shouldAutoAdvance) {
      this.nextStep();
      return { advanced: true, view: this.getView() };
    }

    this.touch();
    return { advanced: false, view: this.getView() };
  }

  // Pub/Sub
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  touch() {
    this.updatedAt = Date.now();
    const payload = this.getView();
    for (const callback of this.subscribers) {
      try {
        callback(payload);
      } catch (err) {
        console.error(
          `[Session ${this.id}] Subscriber notification failed:`,
          err,
        );
      }
    }
  }
}

export class SessionStore {
  /**
   * @param {number} [ttlMs=14400000] - 4 hours default TTL
   */
  constructor(ttlMs = 1000 * 60 * 60 * 4) {
    /** @type {Map<string, RecipeSession>} */
    this.sessions = new Map();
    this.ttlMs = ttlMs;

    this.cleanupTimer = setInterval(() => this.cleanup(), 1000 * 60 * 15);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  create(recipe, options = {}) {
    const id = crypto.randomUUID().slice(0, 8);
    const session = new RecipeSession({ id, recipe, ...options });
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  delete(id) {
    return this.sessions.delete(id);
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }
}

export const sessionStore = new SessionStore();

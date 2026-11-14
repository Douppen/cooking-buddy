// Cooking state, kept free of React and the DOM so it reads as the spec for the native
// (Swift/Kotlin) version. The cooking screen has two views of one recipe, side by side:
// the ingredients (left, shown first) and all the steps (right). Each is one vertical list
// the cook scrolls. Input arrives as actions, not keys: swipe right -> next (steps),
// swipe left -> prev (ingredients), pinch on the ask field -> ask. Swiping never wraps.
//
// Questions are about the whole recipe, not one step. The cook's words may also change the
// recipe ("I don't have eggs"); the answer then says what changed, and both views show the
// updated recipe.

import type {Ingredient, Recipe} from './api';
import {countWords, inUnitSystem, measureText, scaleAmountsInText, type UnitSystem} from './units';

export type View = 'ingredients' | 'steps';

/** The views from left to right. */
export const VIEWS: readonly View[] = ['ingredients', 'steps'];

export type Mode =
  | {kind: 'idle'}
  | {kind: 'asking'; question: string}
  | {kind: 'answer'; answer: string; changed: boolean}
  | {kind: 'error'; message: string};

export interface CookingState {
  view: View;
  mode: Mode;
}

export type CookingAction =
  | {type: 'next'}
  | {type: 'prev'}
  | {type: 'show'; view: View}
  | {type: 'ask'; question: string}
  | {type: 'answered'; answer: string; changed: boolean}
  | {type: 'failed'; message: string}
  | {type: 'dismiss'};

export const initialCookingState: CookingState = {view: 'ingredients', mode: {kind: 'idle'}};

export function cookingReducer(state: CookingState, action: CookingAction): CookingState {
  switch (action.type) {
    case 'next':
      return {...state, view: 'steps'};
    case 'prev':
      return {...state, view: 'ingredients'};
    case 'show':
      return {...state, view: action.view};
    case 'ask':
      return {...state, mode: {kind: 'asking', question: action.question}};
    case 'answered':
      return {...state, mode: {kind: 'answer', answer: action.answer, changed: action.changed}};
    case 'failed':
      return {...state, mode: {kind: 'error', message: action.message}};
    case 'dismiss':
      return {...state, mode: {kind: 'idle'}};
  }
}

/**
 * The answer shown above the ask field (and read aloud), or null when there's none. It
 * stays on both views for ANSWER_VISIBLE_MS, then goes away.
 */
export function answerText(mode: Mode): {label: string; text: string} | null {
  switch (mode.kind) {
    case 'idle':
    case 'asking':
      return null;
    case 'answer':
      return {label: mode.changed ? 'RECIPE UPDATED' : 'ANSWER', text: mode.answer};
    case 'error':
      return {label: 'NO ANSWER', text: mode.message};
  }
}

/** How long an answer stays on screen. */
export const ANSWER_VISIBLE_MS = 15_000;

/** The servings the cook picked for this recipe (saved on it), else the recipe's own. */
export function servingsOf(recipe: Recipe): number {
  return recipe.servings ?? recipe.base_servings;
}

/**
 * How the cook's servings scale the recipe: amounts are stored for base_servings. Also the
 * words of counted ingredients, so step text scales "2 eggs" (see scaleAmountsInText()).
 */
export function scalingFor(recipe: Recipe): Scaling {
  return {factor: servingsOf(recipe) / recipe.base_servings, counted: countWords(recipe.ingredients)};
}

export interface Scaling {
  factor: number;
  counted: string[];
}

const UNSCALED: Scaling = {factor: 1, counted: []};

/**
 * One ingredient line for the cook's servings, in the cook's unit system:
 * "250 g Plain flour" or "8.8 oz Plain flour", "2 Egg". Same amounts as the server gives
 * the AI (server/scaling.js), so answers match what the cook sees.
 */
export function ingredientLine(ingredient: Ingredient, system: UnitSystem, scaling: Scaling = UNSCALED): string {
  const amount = measureText(ingredient.base_amount * scaling.factor, ingredient.base_unit, system);
  const line = `${amount} ${inUnitSystem(ingredient.name, system)}`;
  return ingredient.optional ? `${line} (optional)` : line;
}

/**
 * Step text for the cook's servings and unit system: amounts scaled ("Add 140 g butter" for
 * half the servings → "Add 70 g butter"), then "Bake at 200°C" → "Bake at 400°F" in imperial.
 */
export function stepText(text: string, system: UnitSystem, scaling: Scaling = UNSCALED): string {
  return inUnitSystem(scaleAmountsInText(text, scaling.factor, scaling.counted), system);
}

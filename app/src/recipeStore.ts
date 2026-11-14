// The cook's recipes: ones the AI wrote ("carbonara for 4"), with any voice edits ("I
// don't have buttermilk") saved over them. Kept in localStorage, so they survive reloads;
// the server doesn't store them. Storage can be unavailable or cleared at any time, so
// every access is guarded and the app works without it. The cook's metric/imperial choice
// is kept here too.

import type {Recipe} from './api';
import type {UnitSystem} from './units';

const KEY = 'cooking-buddy:recipes:v1';
const UNITS_KEY = 'cooking-buddy:units:v1';
const MAX_SAVED = 20;

type Stored = Record<string, {recipe: Recipe; savedAt: number}>;

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

/** Saved recipes, most recently saved first. */
export function loadSavedRecipes(): Recipe[] {
  return Object.values(read())
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(entry => entry.recipe);
}

/** Saves (or replaces) a recipe and returns the saved list, most recent first. */
export function saveRecipe(recipe: Recipe): Recipe[] {
  const stored = read();
  stored[recipe.recipe_id] = {recipe, savedAt: Date.now()};
  const kept = Object.entries(stored)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_SAVED);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Full or blocked storage: the recipe still works for this session.
  }
  return kept.map(([, entry]) => entry.recipe);
}

/** The unit system the cook picked on the Recipes screen; metric until they switch. */
export function loadUnitSystem(): UnitSystem {
  try {
    return window.localStorage.getItem(UNITS_KEY) === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

export function saveUnitSystem(system: UnitSystem): void {
  try {
    window.localStorage.setItem(UNITS_KEY, system);
  } catch {
    // Blocked storage: the choice still holds for this session.
  }
}

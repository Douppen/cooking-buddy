import {createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode} from 'react';
import type {Recipe} from './api';
import {loadSavedRecipes, loadUnitSystem, saveRecipe as storeRecipe, saveUnitSystem} from './recipeStore';
import type {UnitSystem} from './units';

// The recipes on this device (see recipeStore.ts), mounted outside the page transition so
// going back to the list keeps them. There is no server library: every recipe was written
// by the AI for this cook (from the dish field on the home screen), and voice edits replace it in place.
// Also the cook's metric/imperial choice, which every recipe is shown in.

interface RecipesValue {
  /** Most recently saved first. */
  recipes: Recipe[];
  /** Saves a new recipe, or replaces the one with the same id (an edit). */
  saveRecipe: (recipe: Recipe) => void;
  /** How amounts are shown. Recipes stay stored in metric either way (see units.ts). */
  unitSystem: UnitSystem;
  setUnitSystem: (system: UnitSystem) => void;
}

const RecipesContext = createContext<RecipesValue | null>(null);

export function RecipesProvider({children}: {children: ReactNode}) {
  const [recipes, setRecipes] = useState<Recipe[]>(loadSavedRecipes);
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(loadUnitSystem);
  const recipesRef = useRef(recipes);

  const saveRecipe = useCallback((recipe: Recipe) => {
    const next = storeRecipe(recipe);
    // Keep this session's copy even if storage refused it.
    const updated = next.some(r => r.recipe_id === recipe.recipe_id)
      ? next
      : [recipe, ...recipesRef.current.filter(r => r.recipe_id !== recipe.recipe_id)];
    recipesRef.current = updated;
    setRecipes(updated);
  }, []);

  const setUnitSystem = useCallback((system: UnitSystem) => {
    saveUnitSystem(system);
    setUnitSystemState(system);
  }, []);

  const value = useMemo(
    () => ({recipes, saveRecipe, unitSystem, setUnitSystem}),
    [recipes, saveRecipe, unitSystem, setUnitSystem],
  );
  return <RecipesContext.Provider value={value}>{children}</RecipesContext.Provider>;
}

export function useRecipes(): RecipesValue {
  const value = useContext(RecipesContext);
  if (!value) throw new Error('useRecipes needs RecipesProvider');
  return value;
}

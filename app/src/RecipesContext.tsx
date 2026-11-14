import {createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode} from 'react';
import type {Recipe} from './api';
import {loadSavedRecipes, saveRecipe as storeRecipe} from './recipeStore';

// The recipes on this device (see recipeStore.ts), mounted outside the page transition so
// going back to the list keeps them. There is no server library: every recipe was written
// by the AI for this cook ("Cook something new"), and voice edits replace it in place.

interface RecipesValue {
  /** Most recently saved first. */
  recipes: Recipe[];
  /** Saves a new recipe, or replaces the one with the same id (an edit). */
  saveRecipe: (recipe: Recipe) => void;
}

const RecipesContext = createContext<RecipesValue | null>(null);

export function RecipesProvider({children}: {children: ReactNode}) {
  const [recipes, setRecipes] = useState<Recipe[]>(loadSavedRecipes);
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

  const value = useMemo(() => ({recipes, saveRecipe}), [recipes, saveRecipe]);
  return <RecipesContext.Provider value={value}>{children}</RecipesContext.Provider>;
}

export function useRecipes(): RecipesValue {
  const value = useContext(RecipesContext);
  if (!value) throw new Error('useRecipes needs RecipesProvider');
  return value;
}

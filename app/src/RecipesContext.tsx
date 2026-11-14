import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {listRecipes, loadRecipe, type Recipe, type RecipeSummary} from './api';
import {loadSavedRecipes, saveRecipe as storeRecipe} from './recipeStore';

// Durable app state, mounted outside the page transition so going back to the list
// doesn't refetch or lose it: the server's recipe list, the recipes saved on this device
// (AI-written or AI-edited), and each server recipe once it's opened.

export type RecipeList =
  | {status: 'loading'}
  | {status: 'ready'; recipes: RecipeSummary[]}
  | {status: 'error'};

interface RecipesValue {
  list: RecipeList;
  /** Recipes saved on this device, most recent first. */
  saved: Recipe[];
  /** A saved recipe wins over the server's recipe with the same id (an edited version). */
  getRecipe: (id: string) => Promise<Recipe>;
  saveRecipe: (recipe: Recipe) => void;
}

const RecipesContext = createContext<RecipesValue | null>(null);

export function RecipesProvider({children}: {children: ReactNode}) {
  const [list, setList] = useState<RecipeList>({status: 'loading'});
  const [saved, setSaved] = useState<Recipe[]>(loadSavedRecipes);
  const savedRef = useRef(saved);
  const cache = useRef(new Map<string, Promise<Recipe>>());

  useEffect(() => {
    const controller = new AbortController();
    listRecipes(controller.signal)
      .then(recipes => setList({status: 'ready', recipes}))
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Loading recipes failed:', err);
        setList({status: 'error'});
      });
    return () => controller.abort();
  }, []);

  // Stable across saves (reads saved recipes through a ref), so a page that loaded a
  // recipe doesn't reload it when the cook edits it.
  const getRecipe = useCallback((id: string) => {
    const own = savedRef.current.find(recipe => recipe.recipe_id === id);
    if (own) return Promise.resolve(own);
    let recipe = cache.current.get(id);
    if (!recipe) {
      recipe = loadRecipe(id).catch(err => {
        cache.current.delete(id); // let the next visit retry
        throw err;
      });
      cache.current.set(id, recipe);
    }
    return recipe;
  }, []);

  const saveRecipe = useCallback((recipe: Recipe) => {
    const next = storeRecipe(recipe);
    // Keep this session's copy even if storage refused it.
    const updated = next.some(r => r.recipe_id === recipe.recipe_id)
      ? next
      : [recipe, ...savedRef.current.filter(r => r.recipe_id !== recipe.recipe_id)];
    savedRef.current = updated;
    setSaved(updated);
  }, []);

  const value = useMemo(() => ({list, saved, getRecipe, saveRecipe}), [list, saved, getRecipe, saveRecipe]);
  return <RecipesContext.Provider value={value}>{children}</RecipesContext.Provider>;
}

export function useRecipes(): RecipesValue {
  const value = useContext(RecipesContext);
  if (!value) throw new Error('useRecipes needs RecipesProvider');
  return value;
}

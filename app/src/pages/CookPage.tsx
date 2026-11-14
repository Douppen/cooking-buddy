import {useEffect, useState} from 'react';
import {Page, ScrollView, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {useParams} from 'react-router-dom';
import {RecipeNotFoundError, type Recipe} from '../api';
import {Cooking} from '../Cooking';
import {useRecipes} from '../RecipesContext';

type Load = {status: 'loading'} | {status: 'ready'; recipe: Recipe} | {status: 'missing'} | {status: 'error'};

// The cooking screen for one recipe. No header: the glance screen is the whole display.
export function CookPage() {
  const {id = ''} = useParams();
  const {getRecipe, saveRecipe} = useRecipes();
  const [load, setLoad] = useState<Load>({status: 'loading'});

  // An edit keeps the recipe id, so the cooking screen stays mounted and keeps its step.
  const changeRecipe = (recipe: Recipe) => {
    saveRecipe(recipe);
    setLoad({status: 'ready', recipe});
  };

  useEffect(() => {
    let current = true;
    setLoad({status: 'loading'});
    getRecipe(id)
      .then(recipe => current && setLoad({status: 'ready', recipe}))
      .catch(err => {
        if (!current) return;
        if (!(err instanceof RecipeNotFoundError)) console.error('Loading the recipe failed:', err);
        setLoad({status: err instanceof RecipeNotFoundError ? 'missing' : 'error'});
      });
    return () => {
      current = false;
    };
  }, [id, getRecipe]);

  if (load.status === 'ready') {
    return (
      <Page enableSystemBarInset={false}>
        <Cooking key={load.recipe.recipe_id} recipe={load.recipe} onRecipeChange={changeRecipe} />
      </Page>
    );
  }

  const message =
    load.status === 'loading'
      ? 'Getting the recipe…'
      : load.status === 'missing'
        ? "That recipe isn't here anymore."
        : "Can't reach the kitchen. Check the connection.";
  return (
    <Page enableSystemBarInset={false}>
      <ScrollView tabIndex={0} ariaLabel="Recipe">
        <div className="content-inset">
          <TextView as="p" textStyle={TextStyle.BODY2}>
            {message}
          </TextView>
        </div>
      </ScrollView>
    </Page>
  );
}

import {Page, ScrollView, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {useEffect} from 'react';
import {useLocation, useNavigate, useParams} from 'react-router-dom';
import {Cooking} from '../Cooking';
import {useRecipes} from '../RecipesContext';

// The cooking screen for one recipe saved on this device. No header (an empty one still
// draws a chip over the content): the two views, ingredients and steps, use the whole display.
export function CookPage() {
  const {id = ''} = useParams();
  const {recipes, saveRecipe, unitSystem} = useRecipes();
  const recipe = recipes.find(r => r.recipe_id === id);
  // The chef's handover, when home just opened this recipe. Said once: a reload or coming
  // back with Back doesn't repeat it.
  const location = useLocation();
  const navigate = useNavigate();
  const greeting = (location.state as {greeting?: string | null} | null)?.greeting ?? undefined;
  useEffect(() => {
    if (greeting) navigate(location.pathname, {replace: true, state: null});
  }, [greeting, location.pathname, navigate]);

  // An edit keeps the recipe id, so the cooking screen stays mounted and keeps its view.
  if (recipe) {
    return (
      <Page showHeader={false} enableSystemBarInset={false}>
        <Cooking
          key={recipe.recipe_id}
          recipe={recipe}
          unitSystem={unitSystem}
          onRecipeChange={saveRecipe}
          greeting={greeting}
        />
      </Page>
    );
  }

  return (
    <Page showHeader={false} enableSystemBarInset={false}>
      <ScrollView tabIndex={0} ariaLabel="Recipe">
        <div className="content-inset">
          <TextView as="p" textStyle={TextStyle.BODY2}>
            That recipe isn't here anymore.
          </TextView>
        </div>
      </ScrollView>
    </Page>
  );
}

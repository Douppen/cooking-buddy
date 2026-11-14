import {Page, ScrollView, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {useParams} from 'react-router-dom';
import {Cooking} from '../Cooking';
import {useRecipes} from '../RecipesContext';

// The cooking screen for one recipe saved on this device. No header (an empty one still
// draws a chip over the content): the two views, ingredients and steps, use the whole display.
export function CookPage() {
  const {id = ''} = useParams();
  const {recipes, saveRecipe, unitSystem} = useRecipes();
  const recipe = recipes.find(r => r.recipe_id === id);

  // An edit keeps the recipe id, so the cooking screen stays mounted and keeps its view.
  if (recipe) {
    return (
      <Page showHeader={false} enableSystemBarInset={false}>
        <Cooking key={recipe.recipe_id} recipe={recipe} unitSystem={unitSystem} onRecipeChange={saveRecipe} />
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

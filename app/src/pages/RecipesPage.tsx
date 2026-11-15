import {ListItem, Page, TextColor, TextStyle, TextView, VerticalList} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import type {Recipe} from '../api';
import {servingsOf} from '../cookingState';
import {useRecipes} from '../RecipesContext';
import {cookName} from '../speech';

// Recipe history (/recipes): every recipe saved on this device (up to 20, recipeStore.ts),
// newest first, one row each. Pinching a row opens it for cooking; Back returns here.
// Opened from the "Recipe history" row on home. Native: a scrolling list screen.
export function RecipesPage() {
  const {recipes} = useRecipes();
  const navigate = useNavigate();

  return (
    // No toolkit header (its chip looks like a button): a plain title, as on home.
    <Page showHeader={false} enableSystemBarInset={false}>
      <div className="recipes-shell">
        <h1 className="page-title">
          <TextView as="span" textStyle={TextStyle.BODY2_EMPHASIZED}>
            Recipe history
          </TextView>
        </h1>
        {recipes.length ? (
          <VerticalList ariaLabel="Recipe history">
            {recipes.map(recipe => (
              <ListItem
                key={recipe.recipe_id}
                title={recipe.title}
                subtitle={subtitleOf(recipe)}
                onClick={() => navigate(`/cook/${recipe.recipe_id}`)}
              />
            ))}
          </VerticalList>
        ) : (
          <div className="content-inset">
            <TextView as="p" textStyle={TextStyle.BODY2} textColor={TextColor.SECONDARY}>
              No recipes yet. Say a dish on the home screen.
            </TextView>
          </div>
        )}
      </div>
    </Page>
  );
}

/** "4 servings · Pankaj": the servings it's set to, and its cook if it has one. */
function subtitleOf(recipe: Recipe): string {
  const servings = servingsOf(recipe);
  const cook = cookName(recipe);
  return `${servings} ${servings === 1 ? 'serving' : 'servings'}${cook ? ` · ${cook}` : ''}`;
}

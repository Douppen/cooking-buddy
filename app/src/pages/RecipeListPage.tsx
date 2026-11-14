import {ListItem, Page, VerticalList} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {useRecipes} from '../RecipesContext';

// First screen: the recipes the AI wrote for this cook (most recent first), then
// "Cook something new". With no recipes yet, that last row is the whole list.
export function RecipeListPage() {
  const {recipes} = useRecipes();
  const navigate = useNavigate();

  return (
    <Page headerText="Recipes" enableSystemBarInset={false}>
      <VerticalList insetForHeader ariaLabel="Recipes">
        {recipes.map(recipe => (
          <ListItem
            key={recipe.recipe_id}
            title={recipe.title}
            subtitle={`${recipe.ingredients.length} ingredients · ${recipe.steps.length} steps`}
            onClick={() => navigate(`/cook/${recipe.recipe_id}`)}
          />
        ))}
        <ListItem title="Cook something new" subtitle="Say any dish" onClick={() => navigate('/new')} />
      </VerticalList>
    </Page>
  );
}

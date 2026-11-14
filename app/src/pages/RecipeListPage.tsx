import {ListItem, Page, VerticalList} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {useRecipes} from '../RecipesContext';
import {RecipeListStatusPage} from './RecipeListStatusPage';

// First screen: pick a recipe, or cook something new (last row). Recipes the AI wrote for
// this cook come first; library recipes the AI edited for this cook say "Your version".
export function RecipeListPage() {
  const {list, saved} = useRecipes();
  const navigate = useNavigate();

  if (list.status === 'loading') return <RecipeListStatusPage message="Getting recipes…" />;
  if (list.status === 'error') {
    return <RecipeListStatusPage message="Can't reach the kitchen. Check the connection." />;
  }

  const written = saved.filter(recipe => recipe.origin === 'generated');
  const edited = new Set(
    saved.filter(recipe => recipe.origin !== 'generated' && recipe.edits?.length).map(r => r.recipe_id),
  );

  return (
    <Page headerText="Recipes" enableSystemBarInset={false}>
      <VerticalList insetForHeader ariaLabel="Recipes">
        {written.map(recipe => (
          <ListItem
            key={recipe.recipe_id}
            title={recipe.title}
            subtitle={`${recipe.steps.length} steps`}
            onClick={() => navigate(`/cook/${recipe.recipe_id}`)}
          />
        ))}
        {list.recipes.map(recipe => (
          <ListItem
            key={recipe.recipe_id}
            title={recipe.title}
            subtitle={edited.has(recipe.recipe_id) ? 'Your version' : `${recipe.step_count} steps`}
            onClick={() => navigate(`/cook/${recipe.recipe_id}`)}
          />
        ))}
        <ListItem title="Cook something new" subtitle="Say any dish" onClick={() => navigate('/new')} />
      </VerticalList>
    </Page>
  );
}

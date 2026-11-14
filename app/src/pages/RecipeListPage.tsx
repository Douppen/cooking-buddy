import {ListItem, Page, VerticalList} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {useRecipes} from '../RecipesContext';

// First screen: the recipes the AI wrote for this cook (most recent first), then
// "Cook something new". With no recipes yet, that row is the whole list. Last, a switch
// for imperial units: every recipe's amounts, temperatures and lengths follow it.
export function RecipeListPage() {
  const {recipes, unitSystem, setUnitSystem} = useRecipes();
  const navigate = useNavigate();
  const imperial = unitSystem === 'imperial';

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
        <ListItem
          title="Imperial units"
          subtitle={imperial ? 'Showing oz, cups, °F' : 'Showing g, ml, °C'}
          showSwitch
          checked={imperial}
          onCheckedChange={checked => setUnitSystem(checked ? 'imperial' : 'metric')}
        />
      </VerticalList>
    </Page>
  );
}

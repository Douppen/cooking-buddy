import {useEffect, useRef, useState} from 'react';
import {
  InputTextView,
  ListItem,
  Page,
  TextColor,
  TextStyle,
  TextView,
  VerticalList,
} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {generateRecipe} from '../api';
import {useRecipes} from '../RecipesContext';

type Status = {kind: 'idle'} | {kind: 'writing'; dish: string} | {kind: 'failed'};

// The only screen besides cooking: say a dish ("lasagna for 4") and the AI finds a recipe
// and cooking starts. Above the field, the most recent recipe, so a cook who left it by
// accident pinches it to go back. Older recipes stay saved on the device but aren't listed.
// Last in the list, the switch for imperial units.
export function HomePage() {
  const {recipes, saveRecipe, unitSystem, setUnitSystem} = useRecipes();
  const navigate = useNavigate();
  const [dish, setDish] = useState('');
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const pending = useRef<AbortController | null>(null);
  const latest = recipes[0];
  const imperial = unitSystem === 'imperial';

  useEffect(() => () => pending.current?.abort(), []);

  const send = (text: string) => {
    const asked = text.trim();
    if (!asked || status.kind === 'writing') return;
    setDish('');
    const controller = new AbortController();
    pending.current = controller;
    setStatus({kind: 'writing', dish: asked});
    generateRecipe(asked, controller.signal)
      .then(recipe => {
        if (controller.signal.aborted) return;
        saveRecipe(recipe);
        // Push, so Back from cooking returns here, with this recipe on top.
        navigate(`/cook/${recipe.recipe_id}`);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Writing the recipe failed:', err);
        setStatus({kind: 'failed'});
      });
  };

  const message =
    status.kind === 'writing'
      ? `Finding a recipe for ${status.dish}…`
      : status.kind === 'failed'
        ? "Couldn't find that recipe. Try again."
        : 'What do you want to cook?';

  return (
    <Page headerText="Cooking Buddy" enableSystemBarInset={false}>
      <div className="action-page-shell">
        <VerticalList insetForHeader ariaLabel="Cooking Buddy">
          {latest && (
            <ListItem
              title={latest.title}
              subtitle="Back to your recipe"
              onClick={() => navigate(`/cook/${latest.recipe_id}`)}
            />
          )}
          <ListItem
            title="Imperial units"
            subtitle={imperial ? 'Showing oz, cups, °F' : 'Showing g, ml, °C'}
            showSwitch
            checked={imperial}
            onCheckedChange={checked => setUnitSystem(checked ? 'imperial' : 'metric')}
          />
        </VerticalList>
        <div className="answer-dock" aria-live="polite">
          <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
            {message}
          </TextView>
          {status.kind === 'idle' && (
            <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
              Say a dish, like “lasagna for 4”.
            </TextView>
          )}
        </div>
        <div className="ask-dock">
          <InputTextView
            text={dish}
            hint="Say a dish"
            onTextChange={setDish}
            onSend={send}
            showActionButton={false}
            showLoader={status.kind === 'writing'}
            loadingLabel="Finding a recipe"
            inputProps={{'aria-label': 'Dish to cook', maxLength: 200}}
          />
        </div>
      </div>
    </Page>
  );
}

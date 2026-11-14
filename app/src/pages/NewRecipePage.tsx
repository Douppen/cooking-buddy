import {useEffect, useRef, useState} from 'react';
import {InputTextView, Page, ScrollView, TextColor, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {generateRecipe} from '../api';
import {useRecipes} from '../RecipesContext';

type Status = {kind: 'idle'} | {kind: 'writing'; dish: string} | {kind: 'failed'};

// Say a dish ("carbonara for 4"); the AI writes a classic recipe and cooking starts.
export function NewRecipePage() {
  const {saveRecipe} = useRecipes();
  const navigate = useNavigate();
  const [dish, setDish] = useState('');
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const pending = useRef<AbortController | null>(null);

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
        // Replace this screen, so Back from cooking returns to the recipe list.
        navigate(`/cook/${recipe.recipe_id}`, {replace: true});
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Writing the recipe failed:', err);
        setStatus({kind: 'failed'});
      });
  };

  const main =
    status.kind === 'writing'
      ? `Writing a recipe for ${status.dish}…`
      : status.kind === 'failed'
        ? "Couldn't write that recipe. Try again."
        : 'What do you want to cook?';

  return (
    <Page headerText="New recipe" enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader ariaLabel="New recipe">
          <div className="content-inset">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED} aria-live="polite">
              {main}
            </TextView>
            <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
              Say a dish, like “carbonara for 4”.
            </TextView>
          </div>
        </ScrollView>
        <div className="ask-dock">
          <InputTextView
            text={dish}
            hint="Say a dish"
            onTextChange={setDish}
            onSend={send}
            showActionButton={false}
            showLoader={status.kind === 'writing'}
            loadingLabel="Writing the recipe"
            inputProps={{'aria-label': 'Dish to cook', maxLength: 200}}
          />
        </div>
      </div>
    </Page>
  );
}

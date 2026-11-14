import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {
  Container,
  createDefaultContainerMaterial,
  InputTextView,
  ListItem,
  Page,
  Switch,
  TextColor,
  TextStyle,
  TextView,
  VerticalList,
  VisualState,
} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {ServerMessageError, generateRecipe} from '../api';
import {useRecipes} from '../RecipesContext';

type Status = {kind: 'idle'} | {kind: 'writing'; dish: string} | {kind: 'failed'; message?: string};

// The units switch is a label and the toggle, not a list row. Only the toggle is focusable;
// the toolkit's surface around it only shows while it has focus.
const UNITS_TOGGLE_MATERIAL = createDefaultContainerMaterial({
  config: {alphaForState: state => (state === VisualState.DEFAULT ? 0 : 1)},
});

// How many servings the new recipe is for: a box like a list row. While it has focus, swipe right
// (ArrowRight) adds one and swipe left (ArrowLeft) takes one away; elsewhere swipes don't
// touch it. 1 to 8 (the server accepts up to 20, server/generate.js).
const DEFAULT_SERVINGS = 2;
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 8;

function stepServings(servings: number, action: 'next' | 'prev'): number {
  const next = servings + (action === 'next' ? 1 : -1);
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, next));
}

// The only screen besides cooking: say a dish ("lasagna") and the AI finds a recipe and
// cooking starts, for the servings on the row at the bottom. At the top, the most recent
// recipe, so a cook who left it by accident pinches it to go back. Older recipes stay saved
// on the device but aren't listed. Between the field and the servings, the units switch.
export function HomePage() {
  const {recipes, saveRecipe, unitSystem, setUnitSystem} = useRecipes();
  const navigate = useNavigate();
  const [dish, setDish] = useState('');
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const [servings, setServings] = useState(DEFAULT_SERVINGS);
  const pending = useRef<AbortController | null>(null);
  const latest = recipes[0];
  const imperial = unitSystem === 'imperial';

  useEffect(() => () => pending.current?.abort(), []);

  const toggleUnits = () => setUnitSystem(imperial ? 'metric' : 'imperial');

  // Swipes on the focused servings box. Elsewhere on home, left/right do nothing.
  const stepServingsOnSwipe = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    event.stopPropagation();
    setServings(n => stepServings(n, event.key === 'ArrowRight' ? 'next' : 'prev'));
  };
  const servingsLabel =
    (servings > MIN_SERVINGS ? '‹ ' : '') +
    `${servings} ${servings === 1 ? 'serving' : 'servings'}` +
    (servings < MAX_SERVINGS ? ' ›' : '');

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
        // The server's own words when it gave some ("That doesn't sound like something to cook…").
        setStatus({kind: 'failed', message: err instanceof ServerMessageError ? err.message : undefined});
      });
  };

  const message =
    status.kind === 'writing'
      ? `Finding a recipe for ${status.dish}…`
      : status.kind === 'failed'
        ? (status.message ?? "Couldn't find that recipe. Try again.")
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
        </VerticalList>
        <div className="answer-dock" aria-live="polite">
          <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
            {message}
          </TextView>
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
          <div className="units-row">
            <TextView as="span" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
              Imperial units
            </TextView>
            <Container
              role="switch"
              aria-checked={imperial}
              aria-label="Imperial units"
              material={UNITS_TOGGLE_MATERIAL}
              contentClassName="units-toggle"
              onClick={toggleUnits}
            >
              <Switch checked={imperial} animated />
            </Container>
          </div>
          <Container
            role="spinbutton"
            aria-label="Servings"
            aria-valuemin={MIN_SERVINGS}
            aria-valuemax={MAX_SERVINGS}
            aria-valuenow={servings}
            width="100%"
            tabIndex={0}
            onKeyDown={stepServingsOnSwipe}
          >
            <div className="servings-box">
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {servingsLabel}
              </TextView>
              <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                Swipe left or right to change
              </TextView>
            </div>
          </Container>
        </div>
      </div>
    </Page>
  );
}

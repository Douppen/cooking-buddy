import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {
  Container,
  createDefaultContainerMaterial,
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
import {ServerMessageError, askHome, findRecipe, type Turn} from '../api';
import {useRecipes} from '../RecipesContext';
import {AskField, SEND_HINT} from '../AskField';
import {speak, stopSpeaking} from '../speech';

type Status =
  | {kind: 'idle'}
  | {kind: 'thinking'}
  | {kind: 'fetching'; dish: string; servings: number}
  | {kind: 'answered'; answer: string; suggestions: string[]}
  | {kind: 'failed'; message?: string};

// The conversation sent back with each request: enough for follow-ups, small enough to send.
const HISTORY_TURNS = 10;

// The units and voice switches are a label and a toggle each, side by side, not list rows. Only the toggle is focusable;
// the toolkit's surface around it only shows while it has focus.
// The toolkit mounts each material on one container only, so each switch gets its own.
const toggleMaterial = () =>
  createDefaultContainerMaterial({
    config: {alphaForState: state => (state === VisualState.DEFAULT ? 0 : 1)},
  });
const UNITS_TOGGLE_MATERIAL = toggleMaterial();
const VOICE_TOGGLE_MATERIAL = toggleMaterial();

// How many servings the new recipe is for: a box like a list row. While it has focus, swipe right
// (ArrowRight) adds one and swipe left (ArrowLeft) takes one away; elsewhere swipes don't
// touch it. 1 to 8. Saying it works too: "lasagna for 4" sets the box to 4 before the recipe
// is fetched (the server hears the number). Saved on the recipe as `servings`; the recipe
// keeps its own base_servings and the cooking screen scales amounts (scalingFor() in
// cookingState.ts).
const DEFAULT_SERVINGS = 2;
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 8;

function clampServings(servings: number): number {
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(servings)));
}

function stepServings(servings: number, action: 'next' | 'prev'): number {
  return clampServings(servings + (action === 'next' ? 1 : -1));
}

// The only screen besides cooking. The box takes a dish ("lasagna": the AI finds a recipe and
// cooking starts, for the servings on the row at the bottom) or food talk ("ideas for a light
// dinner": a short answer, read aloud, with up to 3 dishes as rows to pinch for the recipe).
// Follow-ups work ("the second one"): the conversation goes along until a recipe opens. At the top, the most recent
// recipe, so a cook who left it by accident pinches it to go back. Older recipes stay saved
// on the device but aren't listed. Between the field and the servings, the units and voice
// switches (voice off: answers are text only).
export function HomePage() {
  const {recipes, saveRecipe, unitSystem, setUnitSystem, voiceOn, setVoiceOn} = useRecipes();
  const navigate = useNavigate();
  const [dish, setDish] = useState('');
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const [servings, setServings] = useState(DEFAULT_SERVINGS);
  const [history, setHistory] = useState<Turn[]>([]);
  const pending = useRef<AbortController | null>(null);
  const latest = recipes[0];
  const imperial = unitSystem === 'imperial';

  useEffect(
    () => () => {
      pending.current?.abort();
      stopSpeaking();
    },
    [],
  );

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

  const busy = status.kind === 'thinking' || status.kind === 'fetching';

  // Two steps: the server sorts what the cook said (a dish, or an answer), then for a dish
  // the recipe is fetched while home shows the dish and the servings box with any number
  // the cook said.
  const send = (text: string) => {
    const said = text.trim();
    if (!said || busy) return;
    setDish('');
    stopSpeaking();
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const {signal} = controller;
    setStatus({kind: 'thinking'});
    askHome(said, history, signal)
      .then(reply => {
        if (signal.aborted) return;
        if (reply.kind === 'answer') {
          // Suggestions go into the history too, so "the second one" can be resolved.
          const offered = reply.suggestions.length ? ` (Suggested: ${reply.suggestions.join('; ')})` : '';
          setHistory(h =>
            [...h, {role: 'cook' as const, text: said}, {role: 'buddy' as const, text: reply.answer + offered}].slice(
              -HISTORY_TURNS,
            ),
          );
          // "Thinking…" stays until the voice starts, then the answer shows with it.
          return speak(reply.answer).then(() => {
            if (signal.aborted) return;
            setStatus({kind: 'answered', answer: reply.answer, suggestions: reply.suggestions});
          });
        }
        // What the cook said wins over the box ("for 4"); the box shows it.
        const chosen = reply.servings ? clampServings(reply.servings) : servings;
        setServings(chosen);
        setStatus({kind: 'fetching', dish: reply.dish, servings: chosen});
        return findRecipe(reply.dish, signal).then(recipe => {
          if (signal.aborted) return;
          // The recipe keeps its source's servings; the cook's choice is saved next to them.
          saveRecipe({...recipe, servings: chosen});
          setHistory([]);
          setStatus({kind: 'idle'});
          // Push, so Back from cooking returns here, with this recipe on top.
          navigate(`/cook/${recipe.recipe_id}`);
        });
      })
      .catch(err => {
        if (signal.aborted) return;
        console.error('The home box failed:', err);
        // The server's own words when it gave some ("Let's keep it to food…").
        setStatus({kind: 'failed', message: err instanceof ServerMessageError ? err.message : undefined});
      });
  };

  const message = (() => {
    // With text to send, how to send it (the glasses' composer hands it over without Enter).
    if (dish.trim() && !busy) return SEND_HINT;
    switch (status.kind) {
      case 'thinking':
        return 'Thinking…';
      case 'fetching':
        return `Getting ${status.dish}, ${status.servings} ${status.servings === 1 ? 'serving' : 'servings'}…`;
      case 'answered':
        return status.answer;
      case 'failed':
        return status.message ?? "Couldn't answer that. Try again.";
      case 'idle':
        // One line, like the field's hint says the rest: a second line pushes the last
        // recipe row into a scroll area (home must fit 600×600 without scrolling).
        return 'What do you want to cook?';
    }
  })();
  const suggestions = status.kind === 'answered' ? status.suggestions : [];
  const oneLine = status.kind === 'idle' || status.kind === 'thinking' || status.kind === 'fetching';

  return (
    <Page headerText="Cooking Buddy" enableSystemBarInset={false}>
      <div className="action-page-shell">
        <VerticalList insetForHeader ariaLabel="Cooking Buddy">
          {latest && suggestions.length === 0 && status.kind !== 'answered' && (
            <ListItem
              title={latest.title}
              subtitle="Back to your recipe"
              onClick={() => navigate(`/cook/${latest.recipe_id}`)}
            />
          )}
          {suggestions.map(suggestion => (
            <ListItem key={suggestion} title={suggestion} subtitle="Get the recipe" onClick={() => send(suggestion)} />
          ))}
        </VerticalList>
        {/* Status lines (not answers or errors) stay on one line, so the last recipe row fits. */}
        <div className={oneLine ? 'answer-dock one-line' : 'answer-dock'} aria-live="polite">
          <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
            {message}
          </TextView>
        </div>
        <div className="ask-dock">
          <AskField
            text={dish}
            hint="Say a dish, or ask for ideas"
            onTextChange={setDish}
            onSend={send}
            busy={busy}
            loadingLabel={status.kind === 'fetching' ? 'Getting the recipe' : 'Thinking'}
            ariaLabel="Dish to cook, or a food question"
            maxLength={200}
          />
          {/* While an answer shows, the setup controls step aside so the answer and its
              dish rows fit the 600×600 display; they're back on the next question. */}
          {status.kind !== 'answered' && (
            <>
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
                <TextView as="span" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                  Voice
                </TextView>
                <Container
                  role="switch"
                  aria-checked={voiceOn}
                  aria-label="Read answers aloud"
                  material={VOICE_TOGGLE_MATERIAL}
                  contentClassName="units-toggle"
                  onClick={() => setVoiceOn(!voiceOn)}
                >
                  <Switch checked={voiceOn} animated />
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
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

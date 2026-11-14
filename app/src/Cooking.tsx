import {useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {timerOutline} from '@wearables-ui-toolkit/icons';
import {
  IconImage,
  Pager,
  PagerPage,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {askQuestion, type Exchange, type Recipe} from './api';
import {
  ANSWER_VISIBLE_MS,
  VIEWS,
  answerText,
  cookingReducer,
  ingredientLine,
  scalingFor,
  servingsOf,
  initialCookingState,
  stepText,
} from './cookingState';
import {AskField, SEND_HINT} from './AskField';
import {speak, stopSpeaking} from './speech';
import {applyTimerCommand, timerDoneText, timerLine, type Timer} from './timers';
import type {UnitSystem} from './units';

// Cooking one recipe: the ingredients, and one swipe right, all the steps. Below both, a
// field for questions or changes ("I don't have eggs"); the answer shows above it. A change
// comes back as a new recipe for onRecipeChange. Amounts show in the cook's unit system.
export function Cooking({
  recipe,
  unitSystem,
  onRecipeChange,
}: {
  recipe: Recipe;
  unitSystem: UnitSystem;
  onRecipeChange: (recipe: Recipe) => void;
}) {
  const [state, dispatch] = useReducer(cookingReducer, initialCookingState);
  // Amounts are stored for the recipe's own servings; the cook's choice scales them.
  const scaling = useMemo(() => scalingFor(recipe), [recipe]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  // The last answer (not a change), sent with the next question: "yes, do it" then makes the
  // change it suggested.
  const lastExchange = useRef<Exchange | undefined>(undefined);
  // Timers the cook started by voice, and the time they're shown at: updated once a minute,
  // not every second (see timers.ts).
  const [timers, setTimers] = useState<Timer[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timers.length) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    // Each timer ends on time: said aloud and shown above the ask field.
    const endings = timers.map(timer =>
      setTimeout(
        () => {
          setTimers(running => running.filter(t => t.id !== timer.id));
          const text = timerDoneText(timer);
          dispatch({type: 'notice', title: 'TIMER', text});
          speak(text);
        },
        Math.max(0, timer.endsAt - Date.now()),
      ),
    );
    return () => {
      clearInterval(tick);
      endings.forEach(clearTimeout);
    };
  }, [timers]);

  // Swipes arrive as ArrowLeft / ArrowRight from the Neural Band or touchpad. The pager also
  // pages on its own while focus is inside it; this covers the ask field having focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      dispatch({type: event.key === 'ArrowRight' ? 'next' : 'prev'});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // An answer shows for a while, then goes away.
  useEffect(() => {
    if (state.mode.kind !== 'answer' && state.mode.kind !== 'error') return;
    const timer = setTimeout(() => dispatch({type: 'dismiss'}), ANSWER_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [state.mode]);

  // Stop any request and speech when the app is hidden or the screen closes.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        pending.current?.abort();
        stopSpeaking();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      pending.current?.abort();
      stopSpeaking();
    };
  }, []);

  const send = (text: string) => {
    const asked = text.trim();
    if (!asked || busy) return;
    setQuestion('');
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    dispatch({type: 'ask', question: asked});
    askQuestion(recipe, asked, unitSystem, controller.signal, lastExchange.current)
      .then(({answer, recipe: changed, timer}) => {
        if (controller.signal.aborted) return;
        if (timer) setTimers(running => applyTimerCommand(running, timer, Date.now()));
        lastExchange.current = changed ? undefined : {question: asked, answer};
        // The answer (and a changed recipe) shows when its voice starts, not before it; a timer
        // above starts at once. A change (new ingredients and steps, or new servings) only
        // says "Recipe updated".
        return speak(changed ? 'Recipe updated.' : answer).then(() => {
          if (controller.signal.aborted) return;
          if (changed) onRecipeChange(changed);
          // A timer's confirmation ("Pasta timer: 10 min.") is labelled TIMER, like its end.
          if (timer && !changed) dispatch({type: 'notice', title: 'TIMER', text: answer});
          else dispatch({type: 'answered', answer, changed: Boolean(changed)});
        });
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Asking failed:', err);
        dispatch({type: 'failed', message: "Couldn't get an answer. Ask again."});
      })
      .finally(() => {
        if (pending.current === controller) pending.current = null;
        setBusy(false);
      });
  };

  const shown = answerText(state.mode);

  return (
    <div className="cooking-shell">
      <Pager
        className="cooking-views"
        currentPageIndex={VIEWS.indexOf(state.view)}
        onPageChange={index => dispatch({type: 'show', view: VIEWS[index]})}
        aria-label={recipe.title}
      >
        <PagerPage>
          <ScrollView tabIndex={0} ariaLabel={`${recipe.title}: ingredients`}>
            <div className="content-inset">
              <div className="recipe-heading">
                <TextView as="h1" textStyle={TextStyle.BODY2_EMPHASIZED}>
                  {recipe.title}
                </TextView>
                <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                  {`Ingredients · serves ${servingsOf(recipe)}`}
                </TextView>
              </div>
              <ul className="recipe-list recipe-list--tight">
                {recipe.ingredients.map(ingredient => (
                  <li key={ingredient.id}>
                    <TextView as="p" textStyle={TextStyle.BODY2}>
                      {ingredientLine(ingredient, unitSystem, scaling)}
                    </TextView>
                  </li>
                ))}
              </ul>
              <TextView as="p" textStyle={TextStyle.META2} textColor={TextColor.SECONDARY}>
                Swipe right for the steps
              </TextView>
            </div>
          </ScrollView>
        </PagerPage>
        <PagerPage>
          <ScrollView tabIndex={0} ariaLabel={`${recipe.title}: steps`}>
            <div className="content-inset">
              <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                {`Steps · ${recipe.steps.length}`}
              </TextView>
              <ol className="recipe-list">
                {recipe.steps.map((step, i) => (
                  <li key={i}>
                    <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                      {`${i + 1} · ${stepText(step.title, unitSystem)}`}
                    </TextView>
                    <TextView as="p" textStyle={TextStyle.BODY2}>
                      {stepText(step.instruction, unitSystem, scaling)}
                    </TextView>
                  </li>
                ))}
              </ol>
            </div>
          </ScrollView>
        </PagerPage>
      </Pager>
      {timers.length > 0 && (
        <div className="timers-dock" aria-label="Timers">
          {timers.map(timer => (
            <div key={timer.id} className="timer-line">
              <IconImage source={timerOutline} className="timer-icon" />
              <TextView as="span" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {timerLine(timer, now)}
              </TextView>
            </div>
          ))}
        </div>
      )}
      <div className="answer-dock" aria-live="polite">
        {/* With text to send, how to send it; then the answer. */}
        {question.trim() && !busy ? (
          <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
            {SEND_HINT}
          </TextView>
        ) : shown && (
          <>
            {shown.label && (
              <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                {shown.label}
              </TextView>
            )}
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              {shown.text}
            </TextView>
          </>
        )}
      </div>
      <div className="ask-dock">
        <AskField
          text={question}
          hint="Ask, or say what you're missing"
          onTextChange={setQuestion}
          onSend={send}
          busy={busy}
          loadingLabel="Thinking"
          ariaLabel="Ask or change the recipe"
          maxLength={500}
        />
      </div>
    </div>
  );
}

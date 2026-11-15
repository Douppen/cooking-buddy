import {useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {
  PaginationIndicator,
  PaginationMode,
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
import {AskField} from './AskField';
import {cookName, playHandover, speak, stopSpeaking, voiceOf} from './speech';
import {TimerDock} from './TimerDock';
import {CHIME_MS, playChime, unlockChime} from './chime';
import {TIMER_DONE_VISIBLE_MS, applyTimerCommand, markDone, timerDoneSpeech, type Timer} from './timers';
import type {UnitSystem} from './units';
import {showAskHint} from './devToolbar';

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
  // Timers the cook started by voice (TimerDock shows them counting down).
  const [timers, setTimers] = useState<Timer[]>([]);

  // Demo aid on a laptop screen only (devToolbar.ts): a note beside the window about asking.
  // Web-only, a native port leaves it out.
  useEffect(() => {
    showAskHint(true);
    return () => showAskHint(false);
  }, []);

  useEffect(() => {
    if (!timers.length) return;
    // Each timer ends on time: its line reads "Time's up", with a ping and then "Time's up!
    // Pasta timer is done.", and goes TIMER_DONE_VISIBLE_MS later.
    const endings = timers.map(timer =>
      timer.done
        ? setTimeout(
            () => setTimers(all => all.filter(t => t.id !== timer.id)),
            Math.max(0, timer.endsAt + TIMER_DONE_VISIBLE_MS - Date.now()),
          )
        : setTimeout(
            () => {
              setTimers(all => markDone(all, timer.id));
              playChime();
              setTimeout(() => void speak(timerDoneSpeech(timer), voiceOf(recipe), 'cooking'), CHIME_MS);
            },
            Math.max(0, timer.endsAt - Date.now()),
          ),
    );
    return () => endings.forEach(clearTimeout);
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

  // Fresh from home: the chef hands over to this recipe's cook, the moment this screen opens
  // (queued by home, audio already loaded). From then on, every answer, change and timer here
  // is in the cook's voice (voiceOf()).
  useEffect(() => playHandover(), []);

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
      // Only this screen's own speech: the screen can remount while it stays open (page
      // transitions), and that must not cut off the handover. Leaving it (Back) does.
      stopSpeaking('cooking');
      if (!window.location.pathname.startsWith(`/cook/${recipe.recipe_id}`)) stopSpeaking('handover');
    };
  }, []);

  const send = (text: string) => {
    const asked = text.trim();
    if (!asked || busy) return;
    // This pinch is a user action: let a timer's ping play later.
    unlockChime();
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
        return speak(changed ? 'Recipe updated.' : answer, voiceOf(recipe), 'cooking').then(() => {
          if (controller.signal.aborted) return;
          if (changed) onRecipeChange(changed);
          // A timer needs no text: its line under the lists is the confirmation (the voice
          // says "Pasta timer: 10 min.").
          if (timer && !changed) dispatch({type: 'dismiss'});
          else dispatch({type: 'answered', answer, changed: Boolean(changed)});
        });
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Asking failed:', err);
        const message = "Couldn't get an answer. Ask again.";
        // Read aloud like an answer, shown when the voice starts.
        return speak(message, voiceOf(recipe), 'cooking').then(() => {
          if (!controller.signal.aborted) dispatch({type: 'failed', message});
        });
      })
      .finally(() => {
        if (pending.current === controller) pending.current = null;
        setBusy(false);
      });
  };

  const shown = answerText(state.mode);

  const page = VIEWS.indexOf(state.view);
  // The field names the recipe's own cook, if it has one: "Ask Pankaj".
  const cook = cookName(recipe);

  return (
    <div className="cooking-shell">
      <Pager
        className="cooking-views"
        currentPageIndex={page}
        onPageChange={index => dispatch({type: 'show', view: VIEWS[index]})}
        aria-label={recipe.title}
      >
        <PagerPage>
          <ScrollView tabIndex={0} ariaLabel={`${recipe.title}: ingredients`}>
            <div className="content-inset">
              <ViewTabs page={0} />
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
            </div>
          </ScrollView>
        </PagerPage>
        <PagerPage>
          <ScrollView tabIndex={0} ariaLabel={`${recipe.title}: steps`}>
            <div className="content-inset">
              <ViewTabs page={1} />
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
      <TimerDock timers={timers} />
      <div className="answer-dock" aria-live="polite">
        {/* The answer, if any (no "how to send" hint here: home has one). */}
        {shown && (
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
          hint={cook ? `Ask ${cook}` : 'Ask, swap, or set timer'}
          shortHint={cook ? `Ask ${cook}` : 'Ask or set a timer'}
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

// Which view this is, and which way to swipe for the other one: "Ingredients • ○ Steps ›".
// The first line of each list, so it scrolls away with it. Not focusable.
function ViewTabs({page}: {page: number}) {
  return (
    <div className="view-tabs" aria-hidden="true">
      <TextView
        as="span"
        textStyle={page === 0 ? TextStyle.META1_EMPHASIZED : TextStyle.META1}
        textColor={page === 0 ? TextColor.PRIMARY : TextColor.SECONDARY}
      >
        {page === 0 ? 'Ingredients' : '‹ Ingredients'}
      </TextView>
      <PaginationIndicator mode={PaginationMode.DOTS} pageCount={VIEWS.length} currentPage={page} />
      <TextView
        as="span"
        textStyle={page === 1 ? TextStyle.META1_EMPHASIZED : TextStyle.META1}
        textColor={page === 1 ? TextColor.PRIMARY : TextColor.SECONDARY}
      >
        {page === 1 ? 'Steps' : 'Steps ›'}
      </TextView>
    </div>
  );
}

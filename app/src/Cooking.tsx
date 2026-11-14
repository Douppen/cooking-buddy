import {useEffect, useReducer, useRef, useState} from 'react';
import {InputTextView, ScrollView, TextColor, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {askQuestion, type Recipe} from './api';
import {ANSWER_VISIBLE_MS, cookingReducer, hudText, initialCookingState} from './cookingState';
import {speak, stopSpeaking} from './speech';

// Cooking one recipe: the current step (or briefly an answer) and a field for questions
// or changes ("I don't have eggs"). A change comes back as a new recipe for onRecipeChange.
export function Cooking({recipe, onRecipeChange}: {recipe: Recipe; onRecipeChange: (recipe: Recipe) => void}) {
  const [state, dispatch] = useReducer(cookingReducer, recipe.steps.length, initialCookingState);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const stillAsking = useRef(false); // false once the cook swipes away from the question

  // Swipes arrive as ArrowLeft / ArrowRight from the Neural Band or touchpad.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      stillAsking.current = false;
      stopSpeaking();
      dispatch({type: event.key === 'ArrowRight' ? 'next' : 'prev'});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // An edit can change the number of steps.
  useEffect(() => {
    dispatch({type: 'recipeChanged', stepCount: recipe.steps.length});
  }, [recipe.steps.length]);

  // An answer replaces the step for a while, then the step comes back.
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
    };
  }, []);

  const send = (text: string) => {
    const asked = text.trim();
    if (!asked || busy) return;
    setQuestion('');
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    stillAsking.current = true;
    dispatch({type: 'ask', question: asked});
    askQuestion(recipe, state.stepIndex, asked, controller.signal)
      .then(({answer, recipe: changed}) => {
        if (controller.signal.aborted) return;
        if (changed) onRecipeChange(changed);
        dispatch({type: 'answered', answer, changed: Boolean(changed)});
        if (changed || stillAsking.current) speak(answer);
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

  // Until the recipeChanged effect runs, the step index can briefly exceed a shorter recipe.
  const step = recipe.steps[Math.min(state.stepIndex, recipe.steps.length - 1)];
  const {label, main} = hudText(state, step.instruction);

  return (
    <div className="action-page-shell">
      <ScrollView ariaLabel={`${recipe.title}, step ${state.stepIndex + 1}`}>
        <div className="content-inset">
          <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
            {label}
          </TextView>
          <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED} aria-live="polite">
            {main}
          </TextView>
        </div>
      </ScrollView>
      <div className="ask-dock">
        <InputTextView
          text={question}
          hint="Ask, or say what you're missing"
          onTextChange={setQuestion}
          onSend={send}
          showActionButton={false}
          showLoader={busy}
          loadingLabel="Thinking"
          inputProps={{'aria-label': 'Ask or change the recipe', maxLength: 500}}
        />
      </div>
    </div>
  );
}

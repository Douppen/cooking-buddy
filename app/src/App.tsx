import {useEffect, useReducer, useRef, useState} from 'react';
import {
  App as WearablesApp,
  InputTextView,
  Page,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {askQuestion, loadFirstRecipe, type Recipe} from './api';
import {
  ANSWER_VISIBLE_MS,
  cookingReducer,
  hudText,
  initialCookingState,
} from './cooking';
import {speak, stopSpeaking} from './speech';

// "Glance + ask": one line on the HUD (the current step, or briefly an answer), a small
// step counter, and one ask field. Swipe moves between steps; pinch on the field opens
// the glasses' dictation, pinch again sends.
export default function App() {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadFirstRecipe(controller.signal)
      .then(setRecipe)
      .catch(err => {
        if (!controller.signal.aborted) setLoadError(true);
        console.error('Loading the recipe failed:', err);
      });
    return () => controller.abort();
  }, []);

  return (
    <WearablesApp>
      <Page enableSystemBarInset={false}>
        {recipe ? (
          <Cooking recipe={recipe} />
        ) : (
          <ScrollView ariaLabel="Cooking Buddy">
            <div className="content-inset">
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {loadError ? "Can't reach the kitchen. Check the connection." : 'Getting the recipe…'}
              </TextView>
            </div>
          </ScrollView>
        )}
      </Page>
    </WearablesApp>
  );
}

function Cooking({recipe}: {recipe: Recipe}) {
  const [state, dispatch] = useReducer(cookingReducer, recipe.steps.length, initialCookingState);
  const [question, setQuestion] = useState('');
  const pending = useRef<AbortController | null>(null);

  // Swipes arrive as ArrowLeft / ArrowRight from the Neural Band or touchpad.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      pending.current?.abort();
      stopSpeaking();
      dispatch({type: event.key === 'ArrowRight' ? 'next' : 'prev'});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // An answer replaces the step for a while, then the step comes back.
  useEffect(() => {
    if (state.mode.kind !== 'answer' && state.mode.kind !== 'error') return;
    const timer = setTimeout(() => dispatch({type: 'dismiss'}), ANSWER_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [state.mode]);

  // Stop any request and speech when the app is hidden or closed.
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
    if (!asked || state.mode.kind === 'asking') return;
    setQuestion('');
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    dispatch({type: 'ask', question: asked});
    askQuestion(recipe, state.stepIndex, asked, controller.signal)
      .then(answer => {
        if (controller.signal.aborted) return;
        dispatch({type: 'answered', answer});
        speak(answer);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Asking failed:', err);
        dispatch({type: 'failed', message: "Couldn't get an answer. Ask again."});
      });
  };

  const {label, main} = hudText(state, recipe.steps[state.stepIndex].instruction);

  return (
    <div className="glance">
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
          hint="Ask about this step"
          onTextChange={setQuestion}
          onSend={send}
          showActionButton={false}
          showLoader={state.mode.kind === 'asking'}
          loadingLabel="Thinking"
          inputProps={{'aria-label': 'Ask about this step', maxLength: 500}}
        />
      </div>
    </div>
  );
}

// Cooking state for "glance + ask", kept free of React and the DOM so it reads as the spec
// for the native (Swift/Kotlin) version. Input arrives as actions, not keys:
// swipe -> next / prev, pinch on the ask field -> ask. The cook's words may also change
// the recipe ("I don't have eggs"); the screen then shows what changed.

export type Mode =
  | {kind: 'step'}
  | {kind: 'asking'; question: string}
  | {kind: 'answer'; answer: string; changed: boolean}
  | {kind: 'error'; message: string};

export interface CookingState {
  stepIndex: number;
  stepCount: number;
  mode: Mode;
}

export type CookingAction =
  | {type: 'next'}
  | {type: 'prev'}
  | {type: 'ask'; question: string}
  | {type: 'answered'; answer: string; changed: boolean}
  | {type: 'failed'; message: string}
  | {type: 'dismiss'}
  | {type: 'recipeChanged'; stepCount: number};

export function initialCookingState(stepCount: number): CookingState {
  return {stepIndex: 0, stepCount, mode: {kind: 'step'}};
}

export function cookingReducer(state: CookingState, action: CookingAction): CookingState {
  switch (action.type) {
    case 'next':
    case 'prev': {
      // Swiping always returns to the step view, even mid-answer. A pending question keeps
      // running: if it changes the recipe, that still lands.
      const delta = action.type === 'next' ? 1 : -1;
      const stepIndex = clamp(state.stepIndex + delta, state.stepCount);
      return {...state, stepIndex, mode: {kind: 'step'}};
    }
    case 'ask':
      return {...state, mode: {kind: 'asking', question: action.question}};
    case 'answered':
      // A plain answer that arrives after the cook swiped away is dropped. A recipe change
      // is always shown, so the cook knows what changed.
      return state.mode.kind === 'asking' || action.changed
        ? {...state, mode: {kind: 'answer', answer: action.answer, changed: action.changed}}
        : state;
    case 'failed':
      return state.mode.kind === 'asking'
        ? {...state, mode: {kind: 'error', message: action.message}}
        : state;
    case 'dismiss':
      return {...state, mode: {kind: 'step'}};
    case 'recipeChanged':
      // An edit can add or remove steps; stay on the same step number where possible.
      return {...state, stepCount: action.stepCount, stepIndex: clamp(state.stepIndex, action.stepCount)};
  }
}

function clamp(stepIndex: number, stepCount: number): number {
  return Math.min(Math.max(stepIndex, 0), stepCount - 1);
}

/** What the one-line HUD shows: a small label and one main line. */
export function hudText(state: CookingState, instruction: string): {label: string; main: string} {
  const counter = `${state.stepIndex + 1}/${state.stepCount}`;
  switch (state.mode.kind) {
    case 'step':
    case 'asking':
      return {label: counter, main: instruction};
    case 'answer':
      return {label: state.mode.changed ? 'RECIPE UPDATED' : 'ANSWER', main: state.mode.answer};
    case 'error':
      return {label: counter, main: state.mode.message};
  }
}

/** How long an answer replaces the step before the step comes back. */
export const ANSWER_VISIBLE_MS = 15_000;

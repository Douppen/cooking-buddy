// Cooking state for "glance + ask", kept free of React and the DOM so it reads as the spec
// for the native (Swift/Kotlin) version. Input arrives as actions, not keys:
// swipe -> next / prev, pinch on the ask field -> ask.

export type Mode =
  | {kind: 'step'}
  | {kind: 'asking'; question: string}
  | {kind: 'answer'; question: string; answer: string}
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
  | {type: 'answered'; answer: string}
  | {type: 'failed'; message: string}
  | {type: 'dismiss'};

export function initialCookingState(stepCount: number): CookingState {
  return {stepIndex: 0, stepCount, mode: {kind: 'step'}};
}

export function cookingReducer(state: CookingState, action: CookingAction): CookingState {
  switch (action.type) {
    case 'next':
    case 'prev': {
      // Swiping always returns to the step view, even mid-answer.
      const delta = action.type === 'next' ? 1 : -1;
      const stepIndex = Math.min(Math.max(state.stepIndex + delta, 0), state.stepCount - 1);
      return {...state, stepIndex, mode: {kind: 'step'}};
    }
    case 'ask':
      return {...state, mode: {kind: 'asking', question: action.question}};
    case 'answered':
      // Ignore an answer that arrives after the cook swiped away.
      return state.mode.kind === 'asking'
        ? {...state, mode: {kind: 'answer', question: state.mode.question, answer: action.answer}}
        : state;
    case 'failed':
      return state.mode.kind === 'asking'
        ? {...state, mode: {kind: 'error', message: action.message}}
        : state;
    case 'dismiss':
      return {...state, mode: {kind: 'step'}};
  }
}

/** What the one-line HUD shows: a small label and one main line. */
export function hudText(state: CookingState, instruction: string): {label: string; main: string} {
  const counter = `${state.stepIndex + 1}/${state.stepCount}`;
  switch (state.mode.kind) {
    case 'step':
      return {label: counter, main: instruction};
    case 'asking':
      return {label: counter, main: instruction};
    case 'answer':
      return {label: 'ANSWER', main: state.mode.answer};
    case 'error':
      return {label: counter, main: state.mode.message};
  }
}

/** How long an answer replaces the step before the step comes back. */
export const ANSWER_VISIBLE_MS = 15_000;

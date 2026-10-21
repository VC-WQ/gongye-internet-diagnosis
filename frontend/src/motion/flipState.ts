/** Only inert short text is retained. A late finish cannot clear a newer fold. */
export interface FlipState { current: string; previous?: string; revision: number }
export function changeFlip(state: FlipState, value: string, reduced = false): FlipState {
  if (state.current === value) return state
  return { current: value, previous: reduced ? undefined : state.current, revision: state.revision + 1 }
}
export function finishFlip(state: FlipState, revision: number): FlipState {
  return state.revision === revision ? { ...state, previous: undefined } : state
}

/** Changing the motion preference also invalidates every outstanding completion. */
export function stopFlip(state: FlipState): FlipState {
  return state.previous === undefined ? state : { current: state.current, revision: state.revision + 1 }
}

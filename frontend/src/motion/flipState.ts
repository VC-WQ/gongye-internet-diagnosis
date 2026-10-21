/** Only inert short text is retained. A late finish cannot clear a newer fold. */
export interface FlipState { current: string; previous?: string; revision: number }
export function changeFlip(state: FlipState, value: string, reduced = false): FlipState {
  if (state.current === value) return state
  return { current: value, previous: reduced ? undefined : state.current, revision: state.revision + 1 }
}
export function finishFlip(state: FlipState, revision: number): FlipState {
  return state.revision === revision ? { ...state, previous: undefined } : state
}

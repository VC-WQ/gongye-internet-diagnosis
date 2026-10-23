export type ContentPhase = 'idle' | 'exiting' | 'entering'
export interface ContentPresence {
  shownId: string
  targetId: string
  phase: ContentPhase
  revision: number
}

export function initialContentPresence(identity: string): ContentPresence {
  return { shownId: identity, targetId: identity, phase: 'idle', revision: 0 }
}

/** Business identity is already committed. Only the presentation waits for its exit. */
export function requestContentPresence(state: ContentPresence, targetId: string, immediate = false): ContentPresence {
  if (immediate) {
    if (state.shownId === targetId && state.phase === 'idle') return state
    return { shownId: targetId, targetId, phase: 'idle', revision: state.revision + 1 }
  }
  if (state.targetId === targetId) return state
  if (targetId === state.shownId) return { ...state, targetId, phase: 'entering', revision: state.revision + 1 }
  // A -> B -> C keeps the one outgoing A. It never queues an invisible B.
  if (state.phase === 'exiting') return { ...state, targetId }
  return { ...state, targetId, phase: 'exiting', revision: state.revision + 1 }
}

export function finishContentPresence(state: ContentPresence, revision: number): ContentPresence {
  if (state.revision !== revision || state.phase === 'idle') return state
  return state.phase === 'exiting'
    ? { ...state, shownId: state.targetId, phase: 'entering', revision: revision + 1 }
    : { ...state, phase: 'idle', revision: revision + 1 }
}

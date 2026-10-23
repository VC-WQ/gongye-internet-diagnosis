import { useLayoutEffect, useReducer, useRef, type RefObject } from 'react'
import { finishContentPresence, initialContentPresence, requestContentPresence, type ContentPresence } from './contentPresence'
import { DURATION, EASE_CSS, prefersReducedMotion } from './tokens'

type Action = { type: 'request'; identity: string; immediate?: boolean } | { type: 'finish'; revision: number }
const reduce = (state: ContentPresence, action: Action) => action.type === 'finish'
  ? finishContentPresence(state, action.revision)
  : requestContentPresence(state, action.identity, action.immediate)
type Pose = { opacity: string; transform: string; clipPath: string }

/** One presentation subtree. Queries and actions remain owned by the live parent. */
export function useContentTransition<T>(identity: string, content: T, ref: RefObject<HTMLElement>) {
  const [state, dispatch] = useReducer(reduce, identity, initialContentPresence)
  const latest = useRef(identity); latest.current = identity
  const values = useRef(new Map<string, T>())
  // At most the visible composition and latest target are retained. Updating the
  // same identity is a normal data refresh, not another transition.
  if (identity !== state.shownId || state.phase !== 'exiting') values.current.set(identity, content)
  for (const key of values.current.keys()) if (key !== state.shownId && key !== identity) values.current.delete(key)
  const owned = useRef<Animation>()
  const interrupted = useRef<{ id: string; pose: Pose }>()

  useLayoutEffect(() => {
    dispatch({ type: 'request', identity, immediate: prefersReducedMotion() || !ref.current?.animate })
  }, [identity, ref])

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const exiting = state.phase === 'exiting'
    node.inert = exiting
    if (exiting) {
      if (node.contains(document.activeElement)) {
        const destination = node.parentElement?.closest<HTMLElement>('section, article, [data-route-module]') ?? node.parentElement
        if (destination) {
          const tabindex = destination.getAttribute('tabindex')
          destination.tabIndex = -1; destination.focus({ preventScroll: true })
          if (tabindex === null) destination.removeAttribute('tabindex')
          else destination.setAttribute('tabindex', tabindex)
        }
      }
      node.setAttribute('aria-hidden', 'true')
    } else node.removeAttribute('aria-hidden')
    if (state.phase === 'idle') { interrupted.current = undefined; return }
    const visible = values.current.get(state.shownId)
    if (visible == null || visible === false) {
      dispatch({ type: 'finish', revision: state.revision }); return
    }
    if (prefersReducedMotion() || !node.animate) {
      dispatch({ type: 'request', identity: latest.current, immediate: true }); return
    }
    const from = interrupted.current?.id === state.shownId ? interrupted.current.pose : exiting
      ? { opacity: '1', transform: 'translateY(0px)', clipPath: 'inset(0% 0 0 0)' }
      : { opacity: '0', transform: 'translateY(8px)', clipPath: 'inset(100% 0 0 0)' }
    interrupted.current = undefined
    const animation = node.animate([from, exiting
      ? { opacity: '0', transform: 'translateY(-8px)', clipPath: 'inset(0 0 100% 0)' }
      : { opacity: '1', transform: 'translateY(0px)', clipPath: 'inset(0% 0 0 0)' }], {
      duration: DURATION.content * 1000 * (exiting ? .4 : .6),
      easing: exiting ? EASE_CSS.exit : EASE_CSS.outward,
      fill: 'both',
    })
    owned.current = animation
    void animation.finished.then(() => dispatch({ type: 'finish', revision: state.revision })).catch(() => {})
    return () => {
      if (owned.current === animation) {
        const style = getComputedStyle(node)
        interrupted.current = { id: state.shownId, pose: { opacity: style.opacity, transform: style.transform, clipPath: style.clipPath } }
        animation.cancel(); owned.current = undefined
      }
    }
  }, [state.phase, state.shownId, state.revision, ref])

  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const settle = () => dispatch({ type: 'request', identity: latest.current, immediate: true })
    const changed = () => { if (media.matches) settle() }
    let viewport = `${innerWidth}:${innerHeight}:${visualViewport?.width}:${visualViewport?.height}`
    const resized = () => {
      const next = `${innerWidth}:${innerHeight}:${visualViewport?.width}:${visualViewport?.height}`
      if (next !== viewport) { viewport = next; settle() }
    }
    media.addEventListener('change', changed)
    window.addEventListener('resize', resized)
    visualViewport?.addEventListener('resize', resized)
    return () => {
      media.removeEventListener('change', changed); window.removeEventListener('resize', resized)
      visualViewport?.removeEventListener('resize', resized); owned.current?.cancel()
    }
  }, [ref])

  return { content: values.current.has(state.shownId) ? values.current.get(state.shownId)! : content, identity: state.shownId,
    targetIdentity: identity, phase: state.phase, exiting: state.phase === 'exiting' }
}

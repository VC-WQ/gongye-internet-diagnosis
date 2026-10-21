import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { changeFlip, finishFlip, stopFlip, type FlipState } from './flipState'
import { DURATION, EASE_CSS, prefersReducedMotion } from './tokens'
import './mechanical.css'

/** A clipped text window: inert old text goes up while current text enters below. */
export default function FlipText({ value, label, className = '' }: { value: string; label?: string; className?: string }) {
  const [state, setState] = useState<FlipState>({ current: value, revision: 0 })
  const latest = useRef(state)
  const current = useRef<HTMLSpanElement>(null)
  const old = useRef<HTMLSpanElement>(null)
  const animations = useRef<Animation[]>([])
  const outgoing = useRef({ transform: 'none', opacity: '1' })
  const [reserved, setReserved] = useState({ width: 0, height: 0 })

  const cancel = () => {
    for (const animation of animations.current) animation.cancel()
    animations.current = []
  }

  useLayoutEffect(() => {
    const next = changeFlip(latest.current, value, prefersReducedMotion())
    if (next === latest.current) return
    // Read before cancelling: an interrupted B enters its exit from B's actual pose.
    const pose = current.current ? getComputedStyle(current.current) : undefined
    outgoing.current = { transform: pose?.transform ?? 'none', opacity: pose?.opacity ?? '1' }
    cancel()
    latest.current = next
    setState(next)
  }, [value])

  useLayoutEffect(() => {
    const node = current.current
    if (!node) return
    // Reserve the largest measured text slot. Long→short does not pull adjacent
    // values around; CSS caps the reservation at the responsive parent width.
    setReserved(previous => {
      const width = Math.max(previous.width, node.offsetWidth)
      const height = Math.max(previous.height, node.offsetHeight)
      return width === previous.width && height === previous.height ? previous : { width, height }
    })
    if (state.previous === undefined) return
    if (prefersReducedMotion() || typeof node.animate !== 'function') {
      const settled = finishFlip(latest.current, state.revision)
      latest.current = settled
      setState(settled)
      return
    }
    const distance = Math.max(node.offsetHeight, old.current?.offsetHeight ?? 0, 1)
    const timing = { duration: DURATION.flip * 1000, easing: EASE_CSS.balanced }
    const incoming = node.animate([
      { transform: `translateY(${distance}px)` },
      { transform: 'translateY(0px)' },
    ], timing)
    const leaving = old.current?.animate([
      outgoing.current,
      { transform: `translateY(-${distance}px)`, opacity: 1 },
    ], timing)
    animations.current = leaving ? [incoming, leaving] : [incoming]
    void incoming.finished.then(() => {
      // A late finish from an interrupted transition cannot clear a newer pair.
      const settled = finishFlip(latest.current, state.revision)
      if (settled === latest.current) return
      latest.current = settled
      setState(settled)
      animations.current = []
    }).catch(() => {})
    return cancel
  }, [state.revision, state.previous])

  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => {
      if (!media.matches) return
      cancel()
      const settled = stopFlip(latest.current)
      latest.current = settled
      setState(settled)
    }
    media.addEventListener('change', changed)
    return () => { media.removeEventListener('change', changed); cancel() }
  }, [])

  return <span className={`mechanical-text ${state.previous !== undefined ? 'is-folding' : ''} ${className}`}
    data-handoff-state={state.previous === undefined ? 'settled' : 'moving'}
    style={{ '--handoff-reserved-width': `${reserved.width}px`, minHeight: reserved.height || undefined } as CSSProperties}>
    <span className="motion-sr-only">{label ?? value}</span>
    <span className="mechanical-text__track" aria-hidden="true" key={state.revision}>
      {state.previous !== undefined && <span ref={old} className="mechanical-text__old">{state.previous}</span>}
      <span ref={current} className="mechanical-text__new">{state.current}</span>
    </span>
  </span>
}

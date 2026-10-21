import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { changeFlip, finishFlip, type FlipState } from './flipState'
import { DURATION, prefersReducedMotion } from './tokens'
import './mechanical.css'

/** Horizontal hinge: outgoing text folds up, incoming text unfolds from below. */
export default function FlipText({ value, label, className = '' }: { value: string; label?: string; className?: string }) {
  const [state, setState] = useState<FlipState>({ current: value, revision: 0 })
  const latest = useRef(state)
  const current = useRef<HTMLSpanElement>(null)
  const [outgoing, setOutgoing] = useState({ transform: 'none', opacity: '1', origin: '50% 100%' })
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useLayoutEffect(() => {
    const next = changeFlip(latest.current, value, prefersReducedMotion())
    if (next === latest.current) return
    // A→B→C continues B's visible pose instead of snapping B upright first.
    const pose = current.current ? getComputedStyle(current.current) : undefined
    setOutgoing({ transform: pose?.transform ?? 'none', opacity: pose?.opacity ?? '1', origin: pose?.transformOrigin ?? '50% 100%' })
    clearTimeout(timer.current)
    latest.current = next
    setState(next)
    if (next.previous === undefined) return
    timer.current = setTimeout(() => {
      const settled = finishFlip(latest.current, next.revision)
      latest.current = settled
      setState(settled)
    }, DURATION.flip * 1000)
  }, [value])
  useLayoutEffect(() => () => clearTimeout(timer.current), [])
  return <span className={`mechanical-text ${state.previous !== undefined ? 'is-folding' : ''} ${className}`}
    style={{ '--hinge-out-from': outgoing.transform, '--hinge-out-opacity': outgoing.opacity } as CSSProperties}>
    <span className="motion-sr-only">{label ?? value}</span>
    <span className="mechanical-text__track" aria-hidden="true" key={state.revision}>
      {state.previous !== undefined && <span className="mechanical-text__old" style={{ transformOrigin: outgoing.origin }}>{state.previous}</span>}
      <span ref={current} className="mechanical-text__new">{state.current}</span>
    </span>
  </span>
}

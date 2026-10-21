import { useRef, type ReactNode } from 'react'
import { useContentTransition } from './useContentTransition'
import FlipText from './FlipText'
/**
 * Pure-text snapshots opt into a complete vertical handoff. Complex children
 * remain one live subtree with a local entrance, never an inert DOM clone or a
 * second chart/form/provider. Do not claim that entrance is a two-sided handoff.
 */
export default function FlipContent({ identity, children, snapshot, className = '' }: {
  identity: string; children?: ReactNode; snapshot?: string; className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useContentTransition(snapshot === undefined ? identity : '', ref)
  return <div ref={ref} className={`flip-content ${className}`} data-handoff-mode={snapshot === undefined ? 'single-live' : 'text'}>
    {snapshot === undefined ? children : <FlipText value={snapshot} />}
  </div>
}

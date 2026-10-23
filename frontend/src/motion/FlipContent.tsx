import { useRef, type ReactNode } from 'react'
import { useContentTransition } from './useContentTransition'
import FlipText from './FlipText'
/**
 * Pure text uses its measured handoff. Complex content has one presentation
 * subtree: the old view exits inert, then the latest view enters. Do not wrap
 * request providers or business state owners; pass presentation DTOs instead.
 */
export default function FlipContent({ identity, children, snapshot, className = '' }: {
  identity: string; children?: ReactNode; snapshot?: string; className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const transition = useContentTransition(snapshot === undefined ? identity : '', children, ref)
  return <div ref={ref} className={`flip-content ${className}`} data-handoff-mode={snapshot === undefined ? 'single-live' : 'text'}
    data-content-phase={transition.phase} data-content-identity={transition.identity} data-content-target={transition.targetIdentity}>
    {snapshot === undefined ? transition.content : <FlipText value={snapshot} />}
  </div>
}

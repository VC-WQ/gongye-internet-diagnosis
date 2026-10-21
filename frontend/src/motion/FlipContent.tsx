import { useRef, type ReactNode } from 'react'
import { useContentTransition } from './useContentTransition'
/** One live subtree: the curtain belongs to the semantic identity, not samples. */
export default function FlipContent({ identity, children, className = '' }: { identity: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useContentTransition(identity, ref)
  return <div ref={ref} className={`flip-content ${className}`}>{children}</div>
}

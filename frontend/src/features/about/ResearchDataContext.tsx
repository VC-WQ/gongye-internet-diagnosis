import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useResource } from '../../hooks/useResource'
import type { EvidenceMap } from './dataContract'
import type { ResearchSource } from './researchRequests'

interface ResearchData {
  evidence: EvidenceMap
  refresh: () => void
  includeRuntime: boolean
}
const Context = createContext<(ResearchData & { choices: Map<string, string> }) | null>(null)
export function ResearchDataProvider({ children, ...value }: ResearchData & { children: ReactNode }) {
  const choices = useRef(new Map<string, string>())
  return <Context.Provider value={{ ...value, choices: choices.current }}>{children}</Context.Provider>
}

/** Keep explicit figure selections when the heavy renderer is released offscreen. */
export function useResearchChoice(key: string) {
  const shared = useContext(Context)
  const [value, setValue] = useState<string | undefined>(() => shared?.choices.get(key))
  return [value, (next: string) => { shared?.choices.set(key, next); setValue(next) }] as const
}

/** Reuse the article's validated payload; standalone consumers retain their existing API. */
export function useResearchSource<T = any>(source: ResearchSource, load: () => Promise<T>) {
  const shared = useContext(Context)
  const local = useResource(`research:${source}`, load, 0, !shared)
  if (!shared) return local
  const entry = shared.evidence[source]
  return {
    data: entry?.status === 'available' ? entry.data as T : undefined,
    loading: !entry || entry.status === 'loading',
    error: entry && !['loading', 'available'].includes(entry.status) ? entry.message : undefined,
    refresh: shared.refresh,
  }
}

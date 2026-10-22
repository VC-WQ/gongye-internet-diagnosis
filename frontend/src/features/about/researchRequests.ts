import type { ResearchFigure } from './research'
import type { EvidenceEntry } from './dataContract'

export type ResearchSource = ResearchFigure | 'steam-analysis'
export const RESEARCH_SOURCES: ResearchSource[] = [
  'dataset-registry', 'classification', 'steam', 'steam-analysis',
  'cwru-signal', 'fpcnn-compare', 'domain-adapt', 'rul-sde-pf', 'xjtu-rul',
  'digital-twin-phm', 'self-evolution-loop', 'smart-factory', 'vision',
]
export const researchSources = (includeRuntime: boolean) => RESEARCH_SOURCES.filter(source => includeRuntime || source !== 'self-evolution-loop')

/** Owned by one article/session, also deduplicates StrictMode's effect replay. */
export class ResearchRequestCache {
  private requests = new Map<ResearchSource, Promise<EvidenceEntry>>()
  read(source: ResearchSource, load: () => Promise<EvidenceEntry>) {
    let request = this.requests.get(source)
    if (!request) {
      // Defer the actual transport so both StrictMode effects join the same request.
      request = Promise.resolve().then(load)
      this.requests.set(source, request)
    }
    return request
  }
  clear() { this.requests.clear() }
}

/** Needed sources, including the steam figure's independent correlation payload. */
export function figureSources(figure?: ResearchFigure): ResearchSource[] {
  return !figure?[]:figure==='steam'?['steam','steam-analysis']:figure==='xjtu-rul'||figure==='rul-sde-pf'?['xjtu-rul','rul-sde-pf']:[figure]
}
export function sceneSources(scene: { topic?: unknown; point?: { figure?: ResearchFigure } }): ResearchSource[] {
  return !scene.topic?['dataset-registry']:figureSources(scene.point?.figure)
}

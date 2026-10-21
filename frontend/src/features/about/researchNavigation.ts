import { RESEARCH_TOPICS, type ResearchFigure } from './research'

export const OVERVIEW_ANCHOR = 'research-overview'
export const topicAnchor = (topic: string) => `research-${topic}`
export const pointAnchor = (topic: string, point: string) => `${topicAnchor(topic)}-${point}`
export const RESEARCH_ANCHORS = [OVERVIEW_ANCHOR, ...RESEARCH_TOPICS.flatMap(topic => [
  topicAnchor(topic.id), ...topic.points.map(point => pointAnchor(topic.id, point.id)),
])]
const anchors = new Set(RESEARCH_ANCHORS)

/** Only catalogue anchors are accepted; legacy paths stay untouched for Pico. */
export function researchTarget(hash: string, topicId?: string, pointId?: string): string {
  let id = ''
  try { id = decodeURIComponent(hash.replace(/^#/, '')) } catch { /* invalid URI is not a target */ }
  if (anchors.has(id)) return id
  const topic = RESEARCH_TOPICS.find(item => item.id === topicId)
  if (!topic) return OVERVIEW_ANCHOR
  return pointId && topic.points.some(point => point.id === pointId)
    ? pointAnchor(topic.id, pointId) : topicAnchor(topic.id)
}

export function activeResearchHeading(headings: Array<{ id: string; top: number }>, offset: number, atEnd = false): string {
  if (atEnd && headings.length) return headings[headings.length - 1].id
  let active = OVERVIEW_ANCHOR
  for (const heading of headings) {
    if (heading.top > offset + 24) break
    active = heading.id
  }
  return active
}

/** Whole renderer estimates, not the height of one chart. Measured sizes replace these. */
export function estimateFigureHeight(figure: ResearchFigure, compact: boolean) {
  const sizes: Record<ResearchFigure, [number, number]> = {
    'dataset-registry': [940, 1650], 'cwru-signal': [930, 1720],
    'fpcnn-compare': [1060, 1550], 'domain-adapt': [1230, 1660],
    'rul-sde-pf': [1100, 1590], 'xjtu-rul': [430, 490],
    'digital-twin-phm': [1040, 1690], 'self-evolution-loop': [900, 1210],
    'smart-factory': [930, 1260], classification: [1400, 1830],
    steam: [1290, 1780], vision: [260, 330],
  }
  return sizes[figure][compact ? 1 : 0]
}

export const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/** A late scroll/resize completion must never win over a later click or user gesture. */
export class ResearchScrollIntent {
  private epoch = 0
  begin() { return ++this.epoch }
  cancel() { this.epoch += 1 }
  current(epoch: number) { return this.epoch === epoch }
}

import { RESEARCH_TOPICS } from './research'
import { OVERVIEW_ANCHOR, pointAnchor, topicAnchor } from './researchNavigation'

/** Catalogue IDs remain the route protocol. No headings are used as scroll targets. */
export const RESEARCH_SCENES = [
  { id: OVERVIEW_ANCHOR, title: '研究全景', summary: '从原始信号到寿命预测，把方法、结果与来源放在同一条证据链上。', index: '00', topic: undefined, point: undefined },
  ...RESEARCH_TOPICS.flatMap(topic => [
    { id: topicAnchor(topic.id), title: topic.title, summary: topic.summary, index: topic.index, topic, point: undefined },
    ...topic.points.map((point, i) => ({ id: pointAnchor(topic.id, point.id), title: point.title, summary: point.summary, index: `${topic.index}.${i + 1}`, topic, point })),
  ]),
]
export type ResearchScene = typeof RESEARCH_SCENES[number]
export const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(x) ? x : min))
export const sceneIndex = (id: string) => Math.max(0, RESEARCH_SCENES.findIndex(scene => scene.id === id))

/** 58% reading hold, then one continuous vertical handoff. Reversing scroll reverses the same poses. */
export function stageFrame(position: number, count = RESEARCH_SCENES.length) {
  const p = clamp(position, 0, count - 1)
  const base = Math.floor(p)
  const mix = clamp((p - base - .58) / .42, 0, 1)
  return { base, next: Math.min(base + 1, count - 1), mix, active: Math.min(base + (mix >= .5 ? 1 : 0), count - 1), position: p }
}

export function timelinePosition(scrollY: number, start: number, travel: number, count = RESEARCH_SCENES.length) {
  const position = clamp((scrollY - start) / Math.max(1, travel), 0, 1) * (count - 1)
  const nearest = Math.round(position)
  // scrollY is pixel-quantized. A settled target must not retain a 0.1%-visible
  // retiring chart just because its exact timeline coordinate is fractional.
  return Math.abs(position - nearest) * Math.max(1, travel) / Math.max(1, count - 1) <= 1 ? nearest : position
}

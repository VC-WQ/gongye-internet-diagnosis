import { RESEARCH_TOPICS } from '../../about/research'
import type { PicoReference } from './types'

/** Research citations resolve against the real V2.3 catalogue, never a model URL. */
export function referencePath(reference: PicoReference): string | null {
  if (reference.kind !== 'research') return null
  const [topicId, pointId, extra] = reference.id.split('/')
  if (extra !== undefined) return null
  const topic = RESEARCH_TOPICS.find(item => item.id === topicId)
  if (!topic) return null
  if (pointId === undefined) return `/research/${topic.id}`
  const point = topic.points.find(item => item.id === pointId)
  return point ? `/research/${topic.id}/${point.id}` : null
}

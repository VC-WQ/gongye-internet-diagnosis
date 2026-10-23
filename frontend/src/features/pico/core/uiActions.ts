import { RESEARCH_TOPICS } from '../../about/research'
import type { PicoDeviceFields, PicoUiAction } from './types'

const TYPES = ['pump', 'motor', 'compressor']
const STATUSES = ['healthy', 'degraded', 'fault', 'offline']
const TABS = ['realtime', 'history', 'latent', 'acoustic', 'phm', 'events', 'threshold']
const TOOLS = ['diagnosis', 'events', 'simulation', 'vision', 'pico', 'evaluation', 'settings']
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const keysOnly = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
const entity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
const eventId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0

/** Shared by protocol and the real editor: unknown fields and invented values are rejected. */
export function validatePicoDeviceFields(value: unknown, mode: 'create' | 'edit'): value is PicoDeviceFields {
  if (!isRecord(value) || !keysOnly(value, ['id', 'name', 'device_type', 'health_score', 'status'])) return false
  if (mode === 'edit' && 'id' in value) return false
  if ('id' in value && (typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id))) return false
  if ('name' in value && (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128)) return false
  if ('device_type' in value && !TYPES.includes(value.device_type as string)) return false
  if ('status' in value && !STATUSES.includes(value.status as string)) return false
  if ('health_score' in value && (typeof value.health_score !== 'number' || !Number.isFinite(value.health_score) || value.health_score < 0 || value.health_score > 100)) return false
  return true
}

/** Runtime exact-key validation is mandatory even when the network has TS types. */
export function parsePicoUiAction(value: unknown): PicoUiAction | null {
  if (!isRecord(value) || typeof value.action_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.action_id)) return null
  if (value.type === 'set_theme') {
    return keysOnly(value, ['type', 'action_id', 'theme']) && ['light', 'dark'].includes(value.theme as string) ? value as unknown as PicoUiAction : null
  }
  if (value.type === 'prefill_device_form') {
    if (!keysOnly(value, ['type', 'action_id', 'mode', 'device_id', 'fields']) || !['create', 'edit'].includes(value.mode as string)) return null
    if (value.mode === 'edit' ? !entity(value.device_id) : value.device_id !== undefined) return null
    return validatePicoDeviceFields(value.fields, value.mode as 'create' | 'edit') ? value as unknown as PicoUiAction : null
  }
  if (value.type !== 'navigate' || !keysOnly(value, ['type', 'action_id', 'route_id', 'params']) || !isRecord(value.params)) return null
  const params = value.params
  switch (value.route_id) {
    case 'factory': case 'device_management': case 'records':
      return keysOnly(params, []) ? value as unknown as PicoUiAction : null
    case 'tools':
      return keysOnly(params, ['tool']) && (params.tool === undefined || TOOLS.includes(params.tool as string)) ? value as unknown as PicoUiAction : null
    case 'research': {
      if (!keysOnly(params, ['topic_id', 'point_id'])) return null
      if (params.topic_id === undefined) return params.point_id === undefined ? value as unknown as PicoUiAction : null
      const topic = RESEARCH_TOPICS.find(item => item.id === params.topic_id)
      return topic && (params.point_id === undefined || topic.points.some(item => item.id === params.point_id)) ? value as unknown as PicoUiAction : null
    }
    case 'device_detail':
      return keysOnly(params, ['device_id', 'tab']) && entity(params.device_id) && (params.tab === undefined || TABS.includes(params.tab as string)) ? value as unknown as PicoUiAction : null
    case 'event_detail': case 'report':
      return keysOnly(params, ['event_id', 'device_id']) && eventId(params.event_id) && (params.device_id === undefined || entity(params.device_id)) ? value as unknown as PicoUiAction : null
    default: return null
  }
}

export function picoUiActionPath(action: Extract<PicoUiAction, { type: 'navigate' }>): string {
  switch (action.route_id) {
    case 'factory': return '/dashboard'
    case 'tools': return action.params.tool ? `/tools/${action.params.tool}` : '/tools'
    case 'research': return '/research' + (action.params.topic_id ? `/${action.params.topic_id}` : '') + (action.params.point_id ? `/${action.params.point_id}` : '')
    case 'device_management': return '/admin/devices'
    case 'records': return '/manage/records'
    case 'device_detail': return `/manage/devices/${encodeURIComponent(action.params.device_id)}` + (action.params.tab && action.params.tab !== 'realtime' ? `?detail=${action.params.tab}` : '')
    case 'event_detail': return `/manage/records/${action.params.event_id}`
    case 'report': {
      const query = new URLSearchParams({ event: String(action.params.event_id), section: 'report' })
      if (action.params.device_id) query.set('device', action.params.device_id)
      return `/tools/events?${query}`
    }
  }
}

/** Exactly once per provider lifetime, including replayed responses and StrictMode. */
export class PicoActionRegistry {
  private ids = new Set<string>()
  claim(id: string): boolean {
    if (this.ids.has(id)) return false
    this.ids.add(id)
    return true
  }
}

/** Self-navigation may finish; any different page/selection cancels the in-flight action. */
export class PicoExecutionGuard {
  target?: string
  constructor(private originKey: string, private originUrl?: string) {}
  accept(key: string, url: string): boolean { return (key === this.originKey && (this.originUrl === undefined || url === this.originUrl)) || (this.target !== undefined && url === this.target) }
}

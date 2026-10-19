import type { PicoAction } from './types'

/** 前端动作白名单：Pico 只能导航，不能触发任何写操作。 */
export const ALLOWED_ACTIONS = [
  'open_device',
  'open_event',
  'open_report',
  'switch_workspace_view',
] as const

/** 仅接受站内相对路径，拒绝任意协议/外链注入。 */
export function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020]/.test(path)) return false
  try { if (/[\\\u0000-\u0020]/.test(decodeURIComponent(path))) return false } catch { return false }
  return path === '/' || /^\/(dashboard|devices|diagnose|events|reports|lab|ops)([?#]|$)/.test(path) || /^\/device\/[^/?#]+([?#]|$)/.test(path)
}

export function actionPath(action: PicoAction): string | null {
  const params = action.params ?? {}
  const deviceId =
    typeof params.device_id === 'string' ? params.device_id : undefined
  const rawEvent = params.event_id
  const eventId =
    typeof rawEvent === 'number'
      ? rawEvent
      : typeof rawEvent === 'string' && Number(rawEvent)
        ? Number(rawEvent)
        : undefined

  switch (action.type) {
    case 'open_device':
      return `/device/${encodeURIComponent(deviceId ?? action.target)}`
    case 'open_event': {
      const query = new URLSearchParams()
      if (deviceId) query.set('device', deviceId)
      if (eventId) query.set('event', String(eventId))
      return `/events${query.size ? `?${query}` : ''}`
    }
    case 'open_report': {
      const query = new URLSearchParams()
      if (deviceId) query.set('device', deviceId)
      if (eventId) query.set('event', String(eventId))
      return `/reports${query.size ? `?${query}` : ''}`
    }
    case 'switch_workspace_view':
      return isSafeInternalPath(action.target) ? action.target : null
    default:
      return null
  }
}

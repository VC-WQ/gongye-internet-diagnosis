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
  return path === '/' || /^\/(dashboard|tools|about)([/?#]|$)/.test(path)
}

/** 旧后端动作仍可能返回旧地址；这里一次性迁到 V2.2 四域。 */
const LEGACY_TARGETS: Record<string, string> = {
  '/': '/dashboard',
  '/devices': '/dashboard',
  '/events': '/dashboard?panel=events',
  '/reports': '/dashboard?panel=report',
  '/diagnose': '/dashboard?panel=diagnosis',
  '/lab': '/about/research/signal',
  '/ops': '/tools',
}

function canonicalTarget(target: string): string {
  const [pathname, search = ''] = target.split('?')
  if (pathname === '/ops') {
    const tab = new URLSearchParams(search).get('tab')
    if (tab === 'eval') return '/tools/evaluation'
    if (tab === 'threshold') return '/tools/settings'
    return '/about/research/mechanism'
  }
  const base = LEGACY_TARGETS[pathname.replace(/\/+$/, '') || '/']
  return base ?? target
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
  const isPositive = typeof eventId === 'number' && Number.isInteger(eventId) && eventId > 0

  switch (action.type) {
    case 'open_device': {
      const id = deviceId ?? action.target
      const query = new URLSearchParams({ panel: 'device' })
      if (id) query.set('device', id)
      return `/dashboard?${query}`
    }
    case 'open_event': {
      const query = new URLSearchParams({ panel: 'events' })
      if (deviceId) query.set('device', deviceId)
      if (isPositive) query.set('event', String(eventId))
      return `/dashboard?${query}`
    }
    case 'open_report': {
      const query = new URLSearchParams({ panel: 'report' })
      if (deviceId) query.set('device', deviceId)
      if (isPositive) query.set('event', String(eventId))
      return `/dashboard?${query}`
    }
    case 'switch_workspace_view': {
      const target = canonicalTarget(action.target)
      return isSafeInternalPath(target) ? target : null
    }
    default:
      return null
  }
}

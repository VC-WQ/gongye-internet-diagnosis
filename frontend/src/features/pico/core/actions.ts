import type { PicoAction } from './types'
import { deviceDetailPath, toolPath, legacyRedirect, isSafeInternalPath } from '../../../services/workspaceMode'
export { isSafeInternalPath } from '../../../services/workspaceMode'

/** Pico 只提供站内导航；所有业务写入仍走原有显式流程。 */
export const ALLOWED_ACTIONS = ['open_device', 'open_event', 'open_report', 'switch_workspace_view'] as const

export function actionPath(action: PicoAction): string | null {
  const params = action.params ?? {}
  const deviceId = typeof params.device_id === 'string' ? params.device_id : undefined
  const rawEvent = params.event_id ?? action.target
  const eventId = typeof rawEvent === 'number' || typeof rawEvent === 'string' ? Number(rawEvent) : undefined
  const event = typeof eventId === 'number' && Number.isSafeInteger(eventId) && eventId > 0 ? eventId : undefined
  switch (action.type) {
    case 'open_device': return deviceDetailPath((deviceId ?? action.target) || undefined)
    case 'open_event': return toolPath('events', deviceId, event)
    case 'open_report': return toolPath('events', deviceId, event, 'report')
    case 'switch_workspace_view': {
      const [pathname, search = ''] = action.target.split('?')
      const target = legacyRedirect(pathname, search) ?? action.target
      return isSafeInternalPath(target) ? target : null
    }
    default: return null
  }
}

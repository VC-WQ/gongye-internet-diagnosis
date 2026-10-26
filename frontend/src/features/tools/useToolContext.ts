import { useEffect } from 'react'
import { getEvent, listEvents } from '../../services/api'
import { useResource } from '../../hooks/useResource'
import { useDeviceCatalog, useDeviceTelemetry } from '../../services/realtime'
import { useWorkspace } from '../../services/workspace'
import { usePicoPageAdapter } from '../pico/core/usePicoPageAdapter'

/** Task state stays in the URL; event identity is authoritative on deep links. */
export function useToolContext({ telemetry: needsTelemetry = true } = {}) {
  const workspace = useWorkspace()
  const catalog = useDeviceCatalog()
  const device = catalog.data?.find(item => item.id === workspace.selectedDeviceId)
  const telemetry = useDeviceTelemetry(device?.id, needsTelemetry)
  const eventId = workspace.selectedEventId
  const selected = useResource(`tool-event:${eventId ?? ''}`, () => getEvent(eventId!), 5000, Boolean(eventId))
  const events = useResource(`tool-events:${workspace.selectedDeviceId ?? 'all'}:${workspace.searchFilters.page ?? 1}`, () => listEvents({ device_id: workspace.selectedDeviceId, limit: 20, offset: ((workspace.searchFilters.page ?? 1) - 1) * 20 }), 10000)
  usePicoPageAdapter({
    state: catalog.error || selected.error || events.error ? 'error' : !catalog.data || (eventId && selected.loading && !selected.data) ? 'loading' : 'ready',
    entities: [
      ...(device ? [{ kind: 'device' as const, id: device.id, name: device.name, selected: true }] : []),
      ...(selected.data ? [{ kind: 'event' as const, id: String(selected.data.id), name: `诊断记录 #${selected.data.id}`, selected: true }] : []),
    ],
    visible_data: [
      ...(device ? [{ label: '目录健康评分', value: device.health_score ?? null, entity_id: device.id, source: `/api/v1/devices/${device.id}` }] : []),
      ...(selected.data ? [{ label: '历史诊断评分', value: selected.data.health_score ?? null, entity_id: String(selected.data.id), observed_at: selected.data.timestamp ?? undefined, source: `/api/v1/command-loop/events/${selected.data.id}` }] : []),
    ],
  })
  useEffect(() => {
    if (selected.data && selected.data.device_id !== workspace.selectedDeviceId)
      workspace.setFilters({ device: selected.data.device_id }, { replace: true })
  }, [selected.data?.id, selected.data?.device_id, workspace.selectedDeviceId])
  const refresh = () => { selected.refresh(); events.refresh(); workspace.invalidate() }
  return { workspace, catalog, device, telemetry, eventId, selected, event: selected.data?.device_id === workspace.selectedDeviceId ? selected.data : undefined, events, refresh }
}

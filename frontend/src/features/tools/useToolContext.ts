import { useEffect } from 'react'
import { getEvent, listEvents } from '../../services/api'
import { useResource } from '../../hooks/useResource'
import { useDeviceCatalog, useDeviceTelemetry } from '../../services/realtime'
import { useWorkspace } from '../../services/workspace'

/** Task state stays in the URL; event identity is authoritative on deep links. */
export function useToolContext() {
  const workspace = useWorkspace()
  const catalog = useDeviceCatalog()
  const device = catalog.data?.find(item => item.id === workspace.selectedDeviceId)
  const telemetry = useDeviceTelemetry(device?.id)
  const eventId = workspace.selectedEventId
  const selected = useResource(`tool-event:${eventId ?? ''}`, () => getEvent(eventId!), 5000, Boolean(eventId))
  const events = useResource(`tool-events:${workspace.selectedDeviceId ?? 'all'}:${workspace.searchFilters.page ?? 1}`, () => listEvents({ device_id: workspace.selectedDeviceId, limit: 20, offset: ((workspace.searchFilters.page ?? 1) - 1) * 20 }), 10000)
  useEffect(() => {
    if (selected.data && selected.data.device_id !== workspace.selectedDeviceId)
      workspace.setFilters({ device: selected.data.device_id }, { replace: true })
  }, [selected.data?.id, selected.data?.device_id, workspace.selectedDeviceId])
  const refresh = () => { selected.refresh(); events.refresh(); workspace.invalidate() }
  return { workspace, catalog, device, telemetry, eventId, selected, event: selected.data?.device_id === workspace.selectedDeviceId ? selected.data : undefined, events, refresh }
}

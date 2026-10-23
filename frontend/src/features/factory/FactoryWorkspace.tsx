import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Skeleton } from 'antd'
import FactoryScene from '../../components/FactoryScene'
import StatusOverview from './StatusOverview'
import DeviceNavigator from './DeviceNavigator'
import LiveMonitorPanel from './LiveMonitorPanel'
import CurrentDevicePanel from './CurrentDevicePanel'
import EventReportPanel from './EventReportPanel'
import { listEvents } from '../../services/api'
import { useDeviceCatalog, useDeviceTelemetry } from '../../services/realtime'
import { useResource } from '../../hooks/useResource'
import { useWorkspace } from '../../services/workspace'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { deviceDetailPath, recordDetailPath, toolPath, STATUS_FILTERS, type StatusFilter } from '../../services/workspaceMode'
import { useFactoryEntrance } from '../../motion/useFactoryEntrance'
import './factory.css'

/** The factory is an overview. Analysis and tasks have their own shared routes. */
export default function FactoryWorkspace() {
  const workspace = useWorkspace()
  const navigate = useSpatialNavigate()
  const catalog = useDeviceCatalog()
  const devices = useMemo(() => catalog.data ?? [], [catalog.data])
  const keyword = workspace.searchFilters.q?.trim().toLowerCase() ?? ''
  const filtered = useMemo(() => devices.filter(device =>
    (workspace.statusFilter === 'all' || device.status === workspace.statusFilter) &&
    (!keyword || `${device.name} ${device.id}`.toLowerCase().includes(keyword))),
  [devices, workspace.statusFilter, keyword])
  const selected = devices.find(device => device.id === workspace.selectedDeviceId)
  const outsideFilter = Boolean(selected && !filtered.some(device => device.id === selected.id))
  const telemetry = useDeviceTelemetry(selected?.id)
  const events = useResource(`factory-events:${selected?.id ?? 'all'}`, () => listEvents({ device_id: selected?.id, limit: 20 }), 10000)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullError, setFullError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useFactoryEntrance(root)
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  const counts = useMemo(() => Object.fromEntries(STATUS_FILTERS.map(status => [status,
    status === 'all' ? devices.length : devices.filter(device => device.status === status).length])) as Record<StatusFilter, number>, [devices])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await root.current?.requestFullscreen()
    } catch { setFullError('浏览器未允许全屏，请使用窗口模式') }
  }
  return (
    <div ref={root} className="factory-workspace" data-route-preparing={catalog.loading && !catalog.data ? 'true' : undefined}>
      <div data-factory-entry="status">
        <StatusOverview counts={counts} filter={workspace.statusFilter}
          onFilter={status => workspace.setStatusFilter(workspace.statusFilter === status ? 'all' : status)}
          connection={telemetry.status} fullscreen={fullscreen} onFullscreen={toggleFullscreen} />
      </div>
      {(catalog.error || fullError) && <Alert type="warning" showIcon message={catalog.error ?? fullError}
        action={<Button onClick={() => { catalog.refresh(); setFullError('') }}>重试</Button>} />}
      <div className="factory-board">
        <aside className="factory-board__devices" data-factory-entry="devices">
          <DeviceNavigator devices={filtered} total={devices.length} selectedId={workspace.selectedDeviceId}
            keyword={workspace.searchFilters.q ?? ''} onKeyword={value => workspace.setFilters({ q: value })}
            onSelect={id => workspace.setDevice(id)} selectedOutsideFilter={outsideFilter} />
        </aside>
        <aside className="factory-board__monitor" data-factory-entry="monitor">
          <LiveMonitorPanel device={selected} telemetry={telemetry} channel={workspace.channel ?? 'vibration'} onChannel={workspace.setChannel} />
        </aside>
        <section className="factory-board__scene" aria-label="工厂设备场景" data-factory-entry="scene">
          {catalog.loading && !catalog.data ? <div className="factory-panel factory-scene-loading"><Skeleton active paragraph={{ rows: 8 }} /></div>
            : <FactoryScene devices={filtered} selected={workspace.selectedDeviceId} onSelect={id => workspace.setDevice(id)} onClear={() => workspace.setDevice(undefined)} />}
        </section>
        <aside className="factory-board__current" data-factory-entry="current">
          <CurrentDevicePanel device={selected} devices={devices} outsideFilter={outsideFilter}
            onAnalyze={() => navigate(deviceDetailPath(selected?.id))}
            onDiagnose={() => navigate(toolPath('diagnosis', selected?.id))} />
        </aside>
        <aside className="factory-board__events" data-factory-entry="events">
          <EventReportPanel device={selected} events={events.data ?? []} loading={events.loading} error={events.error}
            onSelect={id => navigate(recordDetailPath(id))} onRefresh={events.refresh}
            onAll={() => navigate(`/manage/records${selected ? `?device=${encodeURIComponent(selected.id)}` : ''}`)} />
        </aside>
      </div>
    </div>
  )
}

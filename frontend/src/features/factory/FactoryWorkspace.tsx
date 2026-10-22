import { useDeviceVisual } from './growth/DeviceVisualProvider'
import { useLayoutEffect, useMemo, useRef } from 'react'
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
  const visual = useDeviceVisual()
  const keyword = workspace.searchFilters.q?.trim().toLowerCase() ?? ''
  const filtered = useMemo(() => devices.filter(device =>
    (workspace.statusFilter === 'all' || device.status === workspace.statusFilter) &&
    (!keyword || `${device.name} ${device.id} ${visual.get(device).displayAlias ?? ''}`.toLowerCase().includes(keyword))),
  [devices, workspace.statusFilter, keyword, visual])
  const selected = devices.find(device => device.id === workspace.selectedDeviceId)
  const outsideFilter = Boolean(selected && !filtered.some(device => device.id === selected.id))
  const telemetry = useDeviceTelemetry(selected?.id)
  const events = useResource(`factory-events:${selected?.id ?? 'all'}`, () => listEvents({ device_id: selected?.id, limit: 20 }), 10000)
  const root = useRef<HTMLDivElement>(null)
  useFactoryEntrance(root)
  useLayoutEffect(() => {
    const node=root.current,board=node?.querySelector<HTMLElement>('.factory-board')
    if(!node||!board)return
    let disposed=false
    const measure=()=>{
      if(disposed)return
      if(!matchMedia('(min-width:1101px)').matches){node.style.removeProperty('--factory-board-height');return}
      const bottom=parseFloat(getComputedStyle(node).paddingBottom)||0
      const top=board.getBoundingClientRect().top+scrollY
      const height=Math.max(360,Math.round((visualViewport?.height??innerHeight)-top-bottom))
      const value=`${height}px`
      if(node.style.getPropertyValue('--factory-board-height')!==value)node.style.setProperty('--factory-board-height',value)
      node.dataset.boardAvailable=String(height)
    }
    measure()
    const observer=new ResizeObserver(measure)
    observer.observe(node)
    const header=document.querySelector('.workspace-header');if(header)observer.observe(header)
    window.addEventListener('resize',measure);visualViewport?.addEventListener('resize',measure)
    void document.fonts.ready.then(measure)
    return()=>{disposed=true;observer.disconnect();window.removeEventListener('resize',measure);visualViewport?.removeEventListener('resize',measure)}
  },[catalog.error])
  const counts = useMemo(() => Object.fromEntries(STATUS_FILTERS.map(status => [status,
    status === 'all' ? devices.length : devices.filter(device => device.status === status).length])) as Record<StatusFilter, number>, [devices])
  return (
    <div ref={root} className="factory-workspace" data-route-preparing={catalog.loading && !catalog.data ? 'true' : undefined}>
      <div data-factory-entry="status" data-route-module="factory-status">
        <StatusOverview counts={counts} filter={workspace.statusFilter}
          onFilter={status => workspace.setStatusFilter(workspace.statusFilter === status ? 'all' : status)}
          connection={telemetry.status} />
      </div>
      {catalog.error && <Alert type="warning" showIcon message={catalog.error}
        action={<Button onClick={catalog.refresh}>重试</Button>} />}
      <div className="factory-board">
        <aside className="factory-board__devices" data-factory-entry="devices" data-route-module="factory-devices">
          <DeviceNavigator devices={filtered} total={devices.length} selectedId={workspace.selectedDeviceId}
            keyword={workspace.searchFilters.q ?? ''} onKeyword={value => workspace.setFilters({ q: value })}
            onSelect={id => workspace.setDevice(id)} selectedOutsideFilter={outsideFilter} />
        </aside>
        <aside className="factory-board__monitor" data-factory-entry="monitor" data-route-module="factory-monitor">
          <LiveMonitorPanel device={selected} telemetry={telemetry} channel={workspace.channel ?? 'vibration'} onChannel={workspace.setChannel} />
        </aside>
        <section className="factory-board__scene" aria-label="工厂设备场景" data-factory-entry="scene" data-route-module="factory-scene">
          {catalog.loading && !catalog.data ? <div className="factory-panel factory-scene-loading"><Skeleton active paragraph={{ rows: 8 }} /></div>
            : <FactoryScene devices={devices} visibleIds={new Set(filtered.map(device => device.id))} selected={workspace.selectedDeviceId} onSelect={id => workspace.setDevice(id)} onClear={() => workspace.setDevice(undefined)} />}
        </section>
        <aside className="factory-board__current" data-factory-entry="current" data-route-module="factory-current">
          <CurrentDevicePanel device={selected} devices={devices} outsideFilter={outsideFilter}
            onAnalyze={() => navigate(deviceDetailPath(selected?.id))}
            onDiagnose={() => navigate(toolPath('diagnosis', selected?.id))} />
        </aside>
        <aside className="factory-board__events" data-factory-entry="events" data-route-module="factory-events">
          <EventReportPanel device={selected} events={events.data ?? []} loading={events.loading} error={events.error}
            onSelect={id => navigate(recordDetailPath(id))} onRefresh={events.refresh}
            onAll={() => navigate(`/manage/records${selected ? `?device=${encodeURIComponent(selected.id)}` : ''}`)} />
        </aside>
      </div>
    </div>
  )
}

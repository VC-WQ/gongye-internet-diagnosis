import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Skeleton } from 'antd'
import FactoryScene from '../../components/FactoryScene'
import StatusOverview from './StatusOverview'
import DeviceNavigator from './DeviceNavigator'
import LiveMonitorPanel from './LiveMonitorPanel'
import CurrentDevicePanel from './CurrentDevicePanel'
import EventReportPanel from './EventReportPanel'
import FactoryExpansion from './FactoryExpansion'
import { getEvent, listEvents, type EventSummary } from '../../services/api'
import { useDeviceCatalog, useDeviceTelemetry } from '../../services/realtime'
import { useResource } from '../../hooks/useResource'
import { useWorkspace } from '../../services/workspace'
import {
  DETAIL_TABS,
  STATUS_FILTERS,
  type DetailTab,
  type FactoryPanel,
  type StatusFilter,
} from '../../services/workspaceMode'
import './factory.css'

const ACTIVE_STATES = ['consulting', 'pending', 'handling', 'observing']

export default function FactoryWorkspace() {
  const workspace = useWorkspace()
  const catalog = useDeviceCatalog()
  const devices = useMemo(() => catalog.data ?? [], [catalog.data])
  const keyword = workspace.searchFilters.q?.trim().toLowerCase() ?? ''
  const filtered = useMemo(
    () =>
      devices.filter((device) => {
        const statusMatch =
          workspace.statusFilter === 'all' ||
          device.status === workspace.statusFilter
        const keywordMatch =
          !keyword ||
          `${device.name} ${device.id}`.toLowerCase().includes(keyword)
        return statusMatch && keywordMatch
      }),
    [devices, workspace.statusFilter, keyword],
  )
  const selected = devices.find(
    (device) => device.id === workspace.selectedDeviceId,
  )
  const outsideFilter = Boolean(
    selected && !filtered.some((device) => device.id === selected.id),
  )
  const telemetry = useDeviceTelemetry(selected?.id)
  const page = workspace.searchFilters.page ?? 1
  const events = useResource(
    `factory-events:${selected?.id ?? ''}:${page}`,
    () =>
      listEvents({
        device_id: selected?.id,
        limit: 20,
        offset: (page - 1) * 20,
      }),
    10000,
    Boolean(selected?.id),
  )
  const eventId = workspace.selectedEventId
  const selectedEvent = useResource(
    `factory-event:${eventId ?? ''}`,
    () => getEvent(eventId!),
    5000,
    Boolean(eventId),
  )
  const eventList = events.data ?? []
  const validEvent =
    selectedEvent.data && selectedEvent.data.device_id === selected?.id
      ? selectedEvent.data
      : undefined
  const activeEvent = eventList.find((event) =>
    ACTIVE_STATES.includes(event.status_state ?? ''),
  )
  const [fullscreen, setFullscreen] = useState(false)
  const [fullError, setFullError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const board = useRef<HTMLDivElement>(null)

  // URL 是选中身份的唯一来源；首次进入只做一次合理的默认选择。
  useEffect(() => {
    if (!catalog.data || workspace.selectedDeviceId) return
    const saved = sessionStorage.getItem('workspace:device')
    const pool = filtered.length ? filtered : devices
    const next = pool.find((device) => device.id === saved) ?? pool[0]
    if (next) workspace.setDevice(next.id)
  }, [
    catalog.data,
    devices,
    filtered,
    workspace.selectedDeviceId,
    workspace.setDevice,
  ])

  useEffect(() => {
    if (!validEvent || validEvent.device_id === workspace.selectedDeviceId)
      return
    workspace.setFilters(
      {
        device: validEvent.device_id,
        event: String(validEvent.id),
      },
      { replace: true },
    )
  }, [
    validEvent,
    validEvent?.id,
    validEvent?.device_id,
    workspace.selectedDeviceId,
    workspace.setDevice,
    workspace.setFilters,
  ])

  useEffect(() => {
    const node = board.current
    if (!node) return
    if (workspace.panel === 'none') {
      node.removeAttribute('inert')
      node.removeAttribute('aria-hidden')
    } else {
      node.setAttribute('inert', '')
      node.setAttribute('aria-hidden', 'true')
    }
  }, [workspace.panel])

  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  const counts = useMemo(() => {
    const value = Object.fromEntries(
      STATUS_FILTERS.map((status) => [
        status,
        status === 'all'
          ? devices.length
          : devices.filter((device) => device.status === status).length,
      ]),
    ) as Record<StatusFilter, number>
    return value
  }, [devices])

  const openPanel = (panel: FactoryPanel, detail?: DetailTab) => {
    workspace.setFilters(
      {
        panel: panel === 'none' ? undefined : panel,
        detail:
          detail && detail !== 'realtime'
            ? detail
            : undefined,
        tab: undefined,
      },
      { replace: false },
    )
  }

  const openEvent = (id: number) => {
    workspace.setFilters(
      {
        event: String(id),
        panel: 'events',
        detail: undefined,
        tab: undefined,
      },
      { replace: false },
    )
  }

  const changeDetail = (tab: DetailTab) => {
    workspace.setFilters(
      {
        panel: 'device',
        detail: tab === 'realtime' ? undefined : tab,
        tab: undefined,
      },
      { replace: true },
    )
  }

  const refreshAll = () => {
    events.refresh()
    selectedEvent.refresh()
    workspace.invalidate()
  }

  const refreshEvent = () => {
    selectedEvent.refresh()
    workspace.invalidate()
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await root.current?.requestFullscreen()
    } catch {
      setFullError('浏览器未允许全屏，请使用窗口模式')
    }
  }

  const channel = workspace.channel ?? 'vibration'

  return (
    <div ref={root} className="factory-workspace">
      <StatusOverview
        counts={counts}
        filter={workspace.statusFilter}
        onFilter={(status) =>
          workspace.setStatusFilter(
            workspace.statusFilter === status ? 'all' : status,
          )
        }
        connection={telemetry.status}
        fullscreen={fullscreen}
        onFullscreen={toggleFullscreen}
      />
      {(catalog.error || fullError) && (
        <Alert
          type="warning"
          showIcon
          message={catalog.error ?? fullError}
          action={
            <Button
              onClick={() => {
                catalog.refresh()
                setFullError('')
              }}
            >
              重试
            </Button>
          }
        />
      )}
      <div className="factory-board-wrap">
        <div ref={board} className="factory-board">
          <aside className="factory-board__devices">
            <DeviceNavigator
              devices={filtered}
              total={devices.length}
              selectedId={workspace.selectedDeviceId}
              keyword={workspace.searchFilters.q ?? ''}
              onKeyword={(value) => workspace.setFilters({ q: value })}
              onSelect={(id) => workspace.setDevice(id)}
              selectedOutsideFilter={outsideFilter}
            />
          </aside>
          <aside className="factory-board__monitor">
            <LiveMonitorPanel
              device={selected}
              telemetry={telemetry}
              channel={channel}
              onChannel={(value) => workspace.setChannel(value)}
              onExpand={() => openPanel('monitor')}
            />
          </aside>
          <section
            className="factory-board__scene"
            aria-label="工厂设备场景"
          >
            {catalog.loading && !catalog.data ? (
              <div className="factory-panel factory-scene-loading">
                <Skeleton active paragraph={{ rows: 8 }} />
              </div>
            ) : (
              <FactoryScene
                devices={filtered}
                selected={workspace.selectedDeviceId}
                onSelect={(id) => workspace.setDevice(id)}
              />
            )}
          </section>
          <aside className="factory-board__current">
            <CurrentDevicePanel
              device={selected}
              outsideFilter={outsideFilter}
              activeEvent={activeEvent}
              onAnalyze={() => openPanel('device', workspace.detailTab)}
              onDiagnose={() => openPanel('diagnosis')}
              onOpenEvent={() => {
                if (activeEvent) openEvent(activeEvent.id)
                else openPanel('events')
              }}
            />
          </aside>
          <aside className="factory-board__events">
            <EventReportPanel
              device={selected}
              events={eventList}
              loading={events.loading}
              error={events.error}
              eventId={eventId}
              page={page}
              onSelect={(id) => workspace.setEvent(id)}
              onOpenEvents={() => openPanel('events')}
              onOpenReport={() => openPanel('report')}
              onRefresh={refreshAll}
              onPage={(next) => workspace.setFilters({ page: String(next) })}
            />
          </aside>
        </div>
        {workspace.panel !== 'none' && (
          <FactoryExpansion
            panel={workspace.panel}
            device={selected}
            telemetry={telemetry}
            detailTab={workspace.detailTab}
            channel={channel}
            events={eventList}
            eventsLoading={events.loading}
            eventsError={events.error}
            eventId={eventId}
            event={validEvent}
            eventLoading={selectedEvent.loading}
            eventError={selectedEvent.error}
            page={page}
            onClose={workspace.closePanel}
            onTab={changeDetail}
            onChannel={(value) => workspace.setChannel(value)}
            onSelectEvent={(id) => workspace.setEvent(id)}
            onOpenEvent={openEvent}
            onPage={(next) => workspace.setFilters({ page: String(next) })}
            onRefreshEvents={events.refresh}
            onRefreshEvent={refreshEvent}
            onRefreshAll={refreshAll}
            onPanel={(panel) => workspace.setPanel(panel)}
          />
        )}
      </div>
    </div>
  )
}

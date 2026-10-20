import { useEffect, useRef } from 'react'
import { Button } from 'antd'
import DeviceAnalysisPanel from './panels/DeviceAnalysisPanel'
import DiagnosisPanel from './panels/DiagnosisPanel'
import EventResolutionPanel from './panels/EventResolutionPanel'
import ReportDocumentPanel from './panels/ReportDocumentPanel'
import type { Device, EventSummary } from '../../services/api'
import type { useDeviceTelemetry } from '../../services/realtime'
import {
  PANEL_LABELS,
  type DetailTab,
  type FactoryPanel,
} from '../../services/workspaceMode'

const TITLES: Partial<Record<FactoryPanel, string>> = {
  device: '设备分析',
  monitor: '设备分析',
  diagnosis: '智能诊断',
  events: '事件与报告',
  report: '事件与报告',
}

export default function FactoryExpansion({
  panel,
  device,
  telemetry,
  detailTab,
  channel,
  events,
  eventsLoading,
  eventsError,
  eventId,
  event,
  eventLoading,
  eventError,
  page,
  onClose,
  onTab,
  onChannel,
  onSelectEvent,
  onOpenEvent,
  onPage,
  onRefreshEvents,
  onRefreshEvent,
  onRefreshAll,
  onPanel,
}: {
  panel: FactoryPanel
  device?: Device
  telemetry: ReturnType<typeof useDeviceTelemetry>
  detailTab: DetailTab
  channel: string
  events: EventSummary[]
  eventsLoading: boolean
  eventsError?: string
  eventId?: number
  event?: EventSummary
  eventLoading: boolean
  eventError?: string
  page: number
  onClose: () => void
  onTab: (tab: DetailTab) => void
  onChannel: (channel: string) => void
  onSelectEvent: (id: number) => void
  onOpenEvent: (id: number) => void
  onPage: (page: number) => void
  onRefreshEvents: () => void
  onRefreshEvent: () => void
  onRefreshAll: () => void
  onPanel: (panel: FactoryPanel) => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(null)

  useEffect(() => {
    returnFocus.current = document.activeElement
    const node = dialogRef.current
    node?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const previous = returnFocus.current
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
    }
  }, [onClose])

  const title = TITLES[panel] ?? PANEL_LABELS[panel]
  const eventMode = panel === 'events' || panel === 'report'
  return (
    <div className="factory-expansion">
      <button
        type="button"
        className="factory-expansion__backdrop"
        aria-label="关闭展开面板"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={`factory-expansion__dialog factory-expansion__dialog--${panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="factory-expansion-title"
      >
        <header className="factory-expansion__head">
          <div className="factory-expansion__identity">
            <span className="factory-expansion__eyebrow">工厂</span>
            <h2 id="factory-expansion-title">{title}</h2>
            <p>
              {device?.name ?? '未选择设备'}
              {event ? ` · 事件 #${event.id}` : ''}
            </p>
          </div>
          {eventMode && (
            <div
              className="factory-expansion__subtabs"
              role="group"
              aria-label="事件与报告视图"
            >
              <button
                type="button"
                className={panel === 'events' ? 'is-active' : ''}
                aria-pressed={panel === 'events'}
                onClick={() => onPanel('events')}
              >
                事件处置
              </button>
              <button
                type="button"
                className={panel === 'report' ? 'is-active' : ''}
                aria-pressed={panel === 'report'}
                onClick={() => onPanel('report')}
              >
                诊断报告
              </button>
            </div>
          )}
          <Button
            data-autofocus
            type="text"
            className="factory-expansion__close"
            aria-label="关闭展开面板"
            onClick={onClose}
          >
            关闭
          </Button>
        </header>
        <div className="factory-expansion__body">
          {(panel === 'device' || panel === 'monitor') && (
            <DeviceAnalysisPanel
              device={device}
              telemetry={telemetry}
              tab={panel === 'monitor' ? 'realtime' : detailTab}
              onTab={onTab}
              channel={channel}
              onChannel={onChannel}
              events={events}
              eventsLoading={eventsLoading}
              eventsError={eventsError}
              onRefreshEvents={onRefreshEvents}
              onSelectEvent={onOpenEvent}
            />
          )}
          {panel === 'diagnosis' && (
            <DiagnosisPanel
              device={device}
              telemetry={telemetry}
              event={event}
              deviceActiveEvent={events.find((item) =>
                ['consulting', 'pending', 'handling', 'observing'].includes(
                  item.status_state ?? '',
                ),
              )}
              eventLoading={eventLoading}
              eventError={eventError}
              onRefreshEvent={onRefreshEvent}
              onChanged={onRefreshAll}
            />
          )}
          {panel === 'events' && (
            <EventResolutionPanel
              device={device}
              events={events}
              loading={eventsLoading}
              error={eventsError}
              event={event}
              eventId={eventId}
              eventLoading={eventLoading}
              eventError={eventError}
              onSelect={onSelectEvent}
              onRefresh={onRefreshAll}
              onRefreshEvent={onRefreshEvent}
              onPage={onPage}
              page={page}
              onOpenReport={() => onPanel('report')}
            />
          )}
          {panel === 'report' && (
            <ReportDocumentPanel
              device={device}
              event={event}
              eventId={eventId}
              events={events}
              loading={eventLoading}
              error={eventError}
              onSelect={onSelectEvent}
              onRefreshEvent={onRefreshEvent}
              onOpenEvent={() => onPanel('events')}
            />
          )}
        </div>
      </div>
    </div>
  )
}

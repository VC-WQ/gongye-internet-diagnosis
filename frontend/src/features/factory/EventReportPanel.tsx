import { Button, Empty } from 'antd'
import { formatTime, LoadState, StatusTag } from '../../components/BusinessUI'
import type { Device, EventSummary } from '../../services/api'

export default function EventReportPanel({
  device,
  events,
  loading,
  error,
  eventId,
  page,
  onSelect,
  onOpenEvents,
  onOpenReport,
  onRefresh,
  onPage,
}: {
  device?: Device
  events: EventSummary[]
  loading: boolean
  error?: string
  eventId?: number
  page: number
  onSelect: (id: number) => void
  onOpenEvents: () => void
  onOpenReport: () => void
  onRefresh: () => void
  onPage: (page: number) => void
}) {
  return (
    <section className="factory-panel factory-panel--events" aria-label="事件与报告">
      <header className="factory-panel__head">
        <h2>事件与报告</h2>
        <span className="factory-panel__count">{events.length}</span>
      </header>
      {!device ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一台设备" />
      ) : (
        <>
          <div className="event-brief">
            <LoadState
              loading={loading && !events.length}
              error={error}
              onRetry={onRefresh}
              empty={!loading && !events.length}
              emptyText="暂无诊断事件"
            >
              {events.slice(0, 3).map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`event-brief__item ${eventId === event.id ? 'is-selected' : ''}`}
                  onClick={() => onSelect(event.id)}
                >
                  <span className="event-brief__main">
                    <b>
                      #{event.id} ·{' '}
                      {event.agent_diagnosis?.fault_label ??
                        event.fault_type ??
                        '诊断事件'}
                    </b>
                    <small>{formatTime(event.timestamp)}</small>
                  </span>
                  <StatusTag status={event.status_state} event />
                </button>
              ))}
            </LoadState>
          </div>
          {events.length > 3 && (
            <div className="event-brief__pager">
              <Button
                size="small"
                type="text"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
              >
                上一页
              </Button>
              <span>第 {page} 页</span>
              <Button
                size="small"
                type="text"
                disabled={events.length < 20}
                onClick={() => onPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
          <div className="event-brief__actions">
            <Button size="small" onClick={onOpenEvents}>
              事件处置
            </Button>
            <Button size="small" onClick={onOpenReport}>
              诊断报告
            </Button>
            <Button size="small" type="text" onClick={onOpenReport}>
              设备快报
            </Button>
            <Button size="small" type="text" onClick={onOpenEvents}>
              全部 ›
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

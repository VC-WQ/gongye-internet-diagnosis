import { Button, Empty } from 'antd'
import Tabs from '../../../motion/ContentTabs'
import DiagnosisSummary from '../../../components/DiagnosisSummary'
import EventActions from '../../../components/EventActions'
import Timeline from '../../../pages/Timeline'
import { formatTime, LoadState, StatusTag } from '../../../components/BusinessUI'
import type { Device, EventSummary } from '../../../services/api'
import { usePageQuery } from '../../../hooks/usePageQuery'
import FlipText from '../../../motion/FlipText'
import FlipContent from '../../../motion/FlipContent'

export default function EventResolutionPanel({
  device,
  events,
  loading,
  error,
  event,
  eventId,
  eventLoading,
  eventError,
  onSelect,
  onRefresh,
  onRefreshEvent,
  onPage,
  page,
  onOpenReport,
  active = true,
}: {
  device?: Device
  events: EventSummary[]
  loading: boolean
  error?: string
  event?: EventSummary
  eventId?: number
  eventLoading: boolean
  eventError?: string
  onSelect: (id: number) => void
  onRefresh: () => void
  onRefreshEvent: () => void
  onPage: (page: number) => void
  page: number
  onOpenReport: () => void
  active?: boolean
}) {
  const { params, update } = usePageQuery()
  const subview = params.get('tab') === 'timeline' ? 'timeline' : 'resolution'
  return (
    <div className="event-workspace">
      <aside className="event-workspace__list" aria-label="事件列表">
        <LoadState
          loading={loading && !events.length}
          error={error}
          onRetry={onRefresh}
          empty={!loading && !events.length}
          emptyText="暂无诊断事件"
        >
          {events.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`record-item ${eventId === item.id ? 'selected' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <span>
                <strong>
                  #{item.id} ·{' '}
                  {item.agent_diagnosis?.fault_label ??
                    item.fault_type ??
                    '诊断事件'}
                </strong>
                <small>{formatTime(item.timestamp)}</small>
              </span>
              <StatusTag status={item.status_state} event />
            </button>
          ))}
        </LoadState>
        <div className="actions-row">
          <Button
            size="small"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            size="small"
            disabled={events.length < 20}
            onClick={() => onPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </aside>
      <section className="event-workspace__detail">
        {!eventId ? (
          <Empty description="选择一条事件查看详情" />
        ) : (
          <LoadState
            loading={eventLoading && !event}
            error={eventError}
            onRetry={onRefreshEvent}
            empty={!event}
            emptyText="未找到事件"
          >
            {event && (
              <>
                <div className="section-header">
                  <h2>
                    <FlipText value={`事件 #${event.id} · ${event.device_id}`} />
                  </h2>
                  <div className="actions-row">
                    <StatusTag status={event.status_state} event />
                    <Button size="small" onClick={onOpenReport}>
                      诊断报告 ›
                    </Button>
                  </div>
                </div>
                <Tabs
                  activeKey={subview}
                  onChange={(value) =>
                    update(
                      { tab: value === 'resolution' ? undefined : value },
                      true,
                    )
                  }
                  items={[
                    {
                      key: 'resolution',
                      label: '诊断与处置',
                      children: (
                        <>
                          <FlipContent identity={String(event.id)}><DiagnosisSummary event={event} /></FlipContent>
                          {active && subview === 'resolution' && <EventActions
                            key={event.id}
                            event={event}
                            onChanged={() => {
                              onRefreshEvent()
                              onRefresh()
                            }}
                          />}
                        </>
                      ),
                    },
                    {
                      key: 'timeline',
                      label: '证据与时间线',
                      children: <Timeline eventId={event.id} active={active && subview === 'timeline'} />,
                    },
                  ]}
                />
              </>
            )}
          </LoadState>
        )}
        {!device && <p className="factory-note">未选择设备</p>}
      </section>
    </div>
  )
}

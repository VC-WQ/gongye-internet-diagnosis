import { Button } from 'antd'
import { formatTime, LoadState, StatusTag } from '../../components/BusinessUI'
import type { Device, EventSummary } from '../../services/api'
export default function EventReportPanel({ device, events, loading, error, onSelect, onRefresh, onAll }: {
  device?: Device; events: EventSummary[]; loading: boolean; error?: string
  onSelect: (id: number) => void; onRefresh: () => void; onAll: () => void
}) {
  return <section className="factory-panel factory-panel--events" aria-label="最近事件">
    <header className="factory-panel__head"><h2>{device ? '设备最近事件' : '全厂最近事件'}</h2><Button size="small" type="text" onClick={onAll}>全部记录 ›</Button></header>
    <div className="event-brief"><LoadState loading={loading && !events.length} error={error} onRetry={onRefresh}
      empty={!loading && !events.length} emptyText="暂无诊断事件">
      {events.slice(0, 4).map(event => <button key={event.id} type="button" className="event-brief__item" onClick={() => onSelect(event.id)}>
        <span className="event-brief__main"><b>#{event.id} · {event.agent_diagnosis?.fault_label ?? event.fault_type ?? '诊断事件'}</b>
          <small>{!device ? `${event.device_id} · ` : ''}{formatTime(event.timestamp)}</small></span><StatusTag status={event.status_state} event />
      </button>)}
    </LoadState></div>
  </section>
}

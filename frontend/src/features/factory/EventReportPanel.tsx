import { Button } from 'antd'
import FlipText from '../../motion/FlipText'
import { useRowPresence } from '../../motion/useRowPresence'
import { formatTime, LoadState, StatusTag } from '../../components/BusinessUI'
import type { Device, EventSummary } from '../../services/api'
export default function EventReportPanel({ device, events, loading, error, onSelect, onRefresh, onAll }: {
  device?: Device; events: EventSummary[]; loading: boolean; error?: string
  onSelect: (id: number) => void; onRefresh: () => void; onAll: () => void
}) {
  const rows = useRowPresence(events.slice(0, 4), event => String(event.id))
  return <section className="factory-panel factory-panel--events" aria-label="最近事件">
    <header className="factory-panel__head"><h2><FlipText value={device ? '设备最近事件' : '全厂最近事件'} /></h2><Button size="small" type="text" onClick={onAll}>全部记录 ›</Button></header>
    <div className="event-brief"><LoadState loading={loading && !events.length} error={error} onRetry={onRefresh}
      empty={!loading && !events.length} emptyText="暂无诊断事件">
      {rows.map(({item: event, exiting, entering}) => <button key={event.id} type="button" disabled={exiting} aria-hidden={exiting || undefined} tabIndex={exiting ? -1 : undefined} className={`event-brief__item event-presence-row ${exiting ? "is-exiting" : entering ? "is-entering" : ""}`} onClick={() => !exiting && onSelect(event.id)}>
        <span className="event-brief__main"><b>#{event.id} · {event.agent_diagnosis?.fault_label ?? event.fault_type ?? '诊断事件'}</b>
          <small>{!device ? `${event.device_id} · ` : ''}{formatTime(event.timestamp)}</small></span><StatusTag animated status={event.status_state} event />
      </button>)}
    </LoadState></div>
  </section>
}

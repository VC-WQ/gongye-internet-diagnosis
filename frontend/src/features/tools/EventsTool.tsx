import { Select, Tabs } from 'antd'
import EventResolutionPanel from '../factory/panels/EventResolutionPanel'
import ReportDocumentPanel from '../factory/panels/ReportDocumentPanel'
import { usePageQuery } from '../../hooks/usePageQuery'
import { useToolContext } from './useToolContext'
import '../factory/factory.css'
export default function EventsTool() {
  const { workspace, catalog, device, eventId, selected, event, events, refresh } = useToolContext({ telemetry: false })
  const { params, update } = usePageQuery()
  const section = params.get('section') === 'report' ? 'report' : 'event'
  return <section className="surface task-workspace">
    <div className="task-context"><label htmlFor="events-device">设备范围</label><Select id="events-device" aria-label="事件设备范围" showSearch allowClear optionFilterProp="label"
      value={workspace.selectedDeviceId} placeholder="全厂事件" onChange={id => workspace.setDevice(id)}
      options={(catalog.data ?? []).map(item => ({ value: item.id, label: `${item.name} · ${item.id}` }))} /></div>
    {workspace.selectedDeviceId && !catalog.loading && !device && <p className="factory-note">设备 {workspace.selectedDeviceId} 已不在当前目录中，历史事件与报告仍可查阅。</p>}
    <Tabs activeKey={section} onChange={key => update({ section: key === 'report' ? 'report' : undefined }, true)} items={[
      { key: 'event', label: '处置与证据', children: <EventResolutionPanel device={device} events={events.data ?? []} loading={events.loading} error={events.error}
        event={event} eventId={eventId} eventLoading={selected.loading} eventError={selected.error}
        onSelect={id => workspace.setEvent(id, { replace: false })} onRefresh={events.refresh} onRefreshEvent={refresh}
        page={workspace.searchFilters.page ?? 1} onPage={page => workspace.setFilters({ page: String(page) })}
        onOpenReport={() => update({ section: 'report' }, true)} /> },
      { key: 'report', label: '报告文档', children: <ReportDocumentPanel device={device} deviceId={workspace.selectedDeviceId} event={event} eventId={eventId} events={events.data ?? []}
        loading={selected.loading} error={selected.error} onSelect={id => workspace.setEvent(id || undefined)} onRefreshEvent={selected.refresh}
        onOpenEvent={() => update({ section: undefined }, true)} /> },
    ]} />
  </section>
}

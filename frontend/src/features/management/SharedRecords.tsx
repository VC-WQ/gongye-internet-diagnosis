import { Button, Card, Select, Space, Table } from 'antd'
import { Navigate } from 'react-router-dom'
import { LoadState, PageHeading, StatusTag, formatTime, numberText } from '../../components/BusinessUI'
import { usePageQuery } from '../../hooks/usePageQuery'
import { useResource } from '../../hooks/useResource'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { listEvents, type EventSummary } from '../../services/api'
import { useDeviceCatalog } from '../../services/realtime'
import { useTableMotion } from '../../motion/useTableMotion'
import './management.css'

export default function SharedRecords() {
  const navigate = useSpatialNavigate()
  const { params, update } = usePageQuery()
  const catalog = useDeviceCatalog()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const deviceId = params.get('device') ?? undefined
  const resource = useResource(`shared-records:${deviceId ?? 'all'}:${page}`, () => listEvents({ device_id: deviceId, offset: (page - 1) * 20, limit: 21 }))
  const tableMotion = useTableMotion((resource.data ?? []).slice(0, 20).map(item => item.id).join('|'))
  const legacyId = params.get('event') ?? params.get('record')
  if (legacyId && /^[1-9]\d*$/.test(legacyId)) {
    const next = new URLSearchParams(params)
    next.delete('event'); next.delete('record')
    return <Navigate replace to={`/manage/records/${legacyId}${next.size ? `?${next}` : ''}`} />
  }
  const open = (event: EventSummary) => navigate(`/manage/records/${event.id}`)
  return (
    <>
      <PageHeading title="诊断记录" meta={<span>只读历史事件与诊断证据 · 所有已登录账号可查看</span>} />
      <Card className="management-list">
        <div className="management-toolbar">
          <Select
            aria-label="记录设备筛选" allowClear showSearch optionFilterProp="label"
            placeholder="全部设备" value={deviceId}
            onChange={(id) => update({ device: id, page: undefined })}
            options={(catalog.data ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))}
          />
          <Button onClick={resource.refresh}>刷新</Button>
        </div>
        <p className="management-hint">点击记录行查看详情。事件处置与报告生成统一在工具区完成。</p>
        <LoadState loading={resource.loading && !resource.data} error={resource.error} onRetry={resource.refresh}>
          <div ref={tableMotion}><Table<EventSummary>
            rowKey="id" dataSource={resource.data?.slice(0, 20) ?? []} pagination={false} scroll={{ x: 800 }}
            onRow={(event) => ({
              tabIndex: 0, className: 'management-row-link', 'aria-label': `查看诊断记录 ${event.id}`,
              onClick: () => open(event),
              onKeyDown: (key) => { if (key.target === key.currentTarget && ['Enter', ' '].includes(key.key)) { key.preventDefault(); open(event) } },
            })}
            columns={[
              { title: '编号', dataIndex: 'id' }, { title: '设备', dataIndex: 'device_id' },
              { title: '故障类型', render: (_, event) => event.agent_diagnosis?.fault_label ?? event.fault_type ?? '—' },
              { title: '健康评分', dataIndex: 'health_score', render: (value) => numberText(value, 0) },
              { title: '状态', dataIndex: 'status_state', render: (value) => <StatusTag status={value} event /> },
              { title: '时间', dataIndex: 'timestamp', render: formatTime },
            ]}
          /></div>
          <div className="management-pagination">
            <Space>
              <Button disabled={page <= 1} onClick={() => update({ page: page > 2 ? String(page - 1) : undefined })}>上一页</Button>
              <span>第 {page} 页</span>
              <Button disabled={(resource.data?.length ?? 0) <= 20} onClick={() => update({ page: String(page + 1) })}>下一页</Button>
            </Space>
          </div>
        </LoadState>
      </Card>
    </>
  )
}

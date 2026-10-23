import { useEffect, useState } from 'react'
import { Button, Card, Select, Space, Table, message } from 'antd'
import { Navigate } from 'react-router-dom'
import { deleteRecord, listRecords } from '../../services/api'
import { useResource } from '../../hooks/useResource'
import { usePageQuery } from '../../hooks/usePageQuery'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { useDeviceCatalog } from '../../services/realtime'
import { formatTime, LoadState, numberText, StatusTag } from '../../components/BusinessUI'
import { BatchControls, BatchResult, type DeleteFailure } from '../../features/management/BatchControls'
import { deleteSelected } from '../../features/management/batchDelete'

interface RecordItem {
  id: number
  device_id: string
  fault_label?: string
  confidence?: number
  health_score?: number
  status_state?: string
  timestamp?: string
}

export default function RecordManagement() {
  const { params, update } = usePageQuery()
  const navigate = useSpatialNavigate()
  const catalog = useDeviceCatalog()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const deviceId = params.get('device') ?? undefined
  const legacyId = params.get('record') ?? params.get('event')
  const data = useResource(`admin-records:${deviceId ?? 'all'}:${page}`, () => listRecords({ device_id: deviceId, offset: (page - 1) * 10, limit: 10 }))
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ deleted: number; failed: DeleteFailure[] }>({ deleted: 0, failed: [] })
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil((data.data?.total ?? 0) / 10))
    if (data.data && !data.loading && page > lastPage)
      update({ page: lastPage > 1 ? String(lastPage) : undefined }, true)
  }, [data.data, data.loading, page])
  if (legacyId && /^[1-9]\d*$/.test(legacyId)) {
    const next = new URLSearchParams(params)
    next.delete('record'); next.delete('event')
    return <Navigate replace to={`/manage/records/${legacyId}${next.size ? `?${next}` : ''}`} />
  }
  const open = (record: RecordItem) => navigate(`/manage/records/${record.id}`)
  const remove = async () => {
    setBusy(true)
    try {
      const value = await deleteSelected(selected, deleteRecord)
      setSelected(value.failed.map(({ id }) => id))
      setResult({ deleted: value.deleted.length, failed: value.failed })
      if (!value.failed.length) message.success(`已删除 ${value.deleted.length} 条诊断记录`)
      data.refresh()
    } finally { setBusy(false) }
  }
  const cancel = () => { setEditing(false); setSelected([]); setResult({ deleted: 0, failed: [] }) }
  return (
    <Card className="management-list">
      <div className="management-toolbar">
        <Select
          aria-label="管理记录设备筛选" allowClear showSearch optionFilterProp="label"
          placeholder="全部设备" value={deviceId}
          onChange={(id) => update({ device: id, page: undefined })}
          options={(catalog.data ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))}
        />
        <Space wrap>
          <Button onClick={data.refresh}>刷新</Button>
          <BatchControls editing={editing} count={selected.length} busy={busy} onEdit={() => setEditing(true)} onCancel={cancel} onDelete={remove} />
        </Space>
      </div>
      <p className="management-hint">{editing ? '仅删除选中记录；失败项保留以便重试。' : '点击记录行查看完整报告、智能体结论与事件时间线。'}</p>
      <BatchResult {...result} />
      <LoadState loading={data.loading && !data.data} error={data.error} onRetry={data.refresh}>
        <Table<RecordItem>
          rowKey="id" dataSource={(data.data?.items ?? []) as RecordItem[]} scroll={{ x: 800 }} loading={busy}
          rowSelection={editing ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(Number)), preserveSelectedRowKeys: true } : undefined}
          onRow={(record) => ({
            tabIndex: editing ? undefined : 0, className: editing ? '' : 'management-row-link',
            onClick: () => { if (!editing) open(record) },
            onKeyDown: (event) => { if (!editing && event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(record) } },
            'aria-label': editing ? undefined : `查看诊断记录 ${record.id}`,
          })}
          pagination={{ current: page, pageSize: 10, total: data.data?.total ?? 0, showSizeChanger: false, onChange: (value) => update({ page: value > 1 ? String(value) : undefined }) }}
          columns={[
            { title: '编号', dataIndex: 'id' }, { title: '设备', dataIndex: 'device_id' },
            { title: '故障类型', dataIndex: 'fault_label', render: (value) => value ?? '—' },
            { title: '置信度', dataIndex: 'confidence', render: (value) => typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—' },
            { title: '健康评分', dataIndex: 'health_score', render: (value) => numberText(value, 0) },
            { title: '状态', dataIndex: 'status_state', render: (value) => <StatusTag status={value} event /> },
            { title: '时间', dataIndex: 'timestamp', render: formatTime },
          ]}
        />
      </LoadState>
    </Card>
  )
}

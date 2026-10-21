import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Select, Space, Table, message } from 'antd'
import { useResource } from '../../hooks/useResource'
import { usePageQuery } from '../../hooks/usePageQuery'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { LoadState, StatusTag, TYPE_LABEL, numberText } from '../../components/BusinessUI'
import { deleteDevice, getDevices, type Device } from '../../services/api'
import DeviceEditor from '../../features/management/DeviceEditor'
import { BatchControls, BatchResult, type DeleteFailure } from '../../features/management/BatchControls'
import { deleteSelected } from '../../features/management/batchDelete'
import { useDeviceFormDraft } from '../../features/management/useDeviceFormDraft'
import { deviceFormDraftChannel } from '../../features/management/deviceFormDraft'
import { useTableMotion } from '../../motion/useTableMotion'

export default function DeviceManagement() {
  const resource = useResource<Device[]>('admin-devices', getDevices)
  const navigate = useSpatialNavigate()
  const { params, update } = usePageQuery()
  const keyword = params.get('q') ?? ''
  const status = params.get('status') ?? 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [creating, setCreating] = useState(false)
  const draft = useDeviceFormDraft('create')
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ deleted: number; failed: DeleteFailure[] }>({ deleted: 0, failed: [] })
  const devices = useMemo(() => (resource.data ?? []).filter((device) =>
    `${device.name} ${device.id}`.toLowerCase().includes(keyword.trim().toLowerCase()) &&
    (status === 'all' || device.status === status),
  ), [keyword, resource.data, status])
  const tableMotion = useTableMotion(`${editing}:${devices.slice((page - 1) * 10, page * 10).map(item => item.id).join('|')}`)
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(devices.length / 10))
    if (resource.data && !resource.loading && page > lastPage)
      update({ page: lastPage > 1 ? String(lastPage) : undefined }, true)
  }, [devices.length, page, resource.data, resource.loading])
  const open = (device: Device) => navigate(`/manage/devices/${encodeURIComponent(device.id)}`)
  const remove = async () => {
    setBusy(true)
    try {
      const value = await deleteSelected(selected, deleteDevice)
      setSelected(value.failed.map(({ id }) => id))
      setResult({ deleted: value.deleted.length, failed: value.failed })
      if (!value.failed.length) message.success(`已删除 ${value.deleted.length} 台设备`)
      resource.refresh()
    } finally { setBusy(false) }
  }
  const cancel = () => { setEditing(false); setSelected([]); setResult({ deleted: 0, failed: [] }) }
  return (
    <Card className="management-list">
      <div className="management-toolbar">
        <Space wrap>
          <Input.Search value={keyword} allowClear aria-label="搜索管理设备" placeholder="搜索名称或编号" onChange={(event) => update({ q: event.target.value || undefined, page: undefined }, true)} />
          <Select aria-label="设备状态筛选" value={status} onChange={(value) => update({ status: value === 'all' ? undefined : value, page: undefined })} options={[
            { value: 'all', label: '全部状态' }, { value: 'healthy', label: '正常' }, { value: 'degraded', label: '退化' }, { value: 'fault', label: '告警' }, { value: 'offline', label: '离线' },
          ]} />
        </Space>
        <Space wrap>
          <BatchControls editing={editing} count={selected.length} busy={busy} onEdit={() => setEditing(true)} onCancel={cancel} onDelete={remove} />
          {!editing && <Button type="primary" onClick={() => setCreating(true)}>新增设备</Button>}
        </Space>
      </div>
      <p className="management-hint">{editing ? '选择设备后集中删除；取消编辑可恢复详情浏览。' : '点击设备行查看完整分析，单台编辑在设备详情中完成。'}</p>
      <BatchResult {...result} />
      <LoadState loading={resource.loading && !resource.data} error={resource.error} onRetry={resource.refresh}>
        <div ref={tableMotion}><Table<Device>
          rowKey="id" dataSource={devices} scroll={{ x: 660 }} loading={busy}
          rowSelection={editing ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)), preserveSelectedRowKeys: true } : undefined}
          onRow={(device) => ({
            tabIndex: editing ? undefined : 0,
            className: editing ? '' : 'management-row-link',
            onClick: () => { if (!editing) open(device) },
            onKeyDown: (event) => { if (!editing && event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(device) } },
            'aria-label': editing ? undefined : `查看设备 ${device.name}`,
          })}
          pagination={{ current: page, pageSize: 10, total: devices.length, showSizeChanger: false, onChange: (value) => update({ page: value > 1 ? String(value) : undefined }) }}
          columns={[
            { title: '设备编号', dataIndex: 'id' },
            { title: '名称', dataIndex: 'name' },
            { title: '类型', dataIndex: 'device_type', render: (value) => TYPE_LABEL[value] ?? value },
            { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
            { title: '健康评分', dataIndex: 'health_score', render: (value) => `${numberText(value, 0)} / 100` },
          ]}
        /></div>
      </LoadState>
      <DeviceEditor open={creating || Boolean(draft)} draft={draft} onClose={() => { if (draft) deviceFormDraftChannel.release(draft.actionId); setCreating(false) }} onSaved={resource.refresh} />
    </Card>
  )
}

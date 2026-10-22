import { useEffect, useState } from 'react'
import { Button, Card, Select, Space } from 'antd'
import { Navigate, useParams } from 'react-router-dom'
import { LoadState, PageHeading } from '../../components/BusinessUI'
import { usePageQuery } from '../../hooks/usePageQuery'
import { useResource } from '../../hooks/useResource'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { getDevice, getMe, listEvents } from '../../services/api'
import { useDeviceCatalog, useDeviceTelemetry } from '../../services/realtime'
import { normalizeChannel, normalizeDetail } from '../../services/workspaceMode'
import DeviceAnalysisPanel from '../factory/panels/DeviceAnalysisPanel'
import DeviceEditor from './DeviceEditor'
import { useDeviceFormDraft } from './useDeviceFormDraft'
import { deviceFormDraftChannel } from './deviceFormDraft'
import './management.css'

export default function SharedDeviceDetail() {
  const { deviceId } = useParams<{ deviceId?: string }>()
  const { params, update } = usePageQuery()
  const navigate = useSpatialNavigate()
  const catalog = useDeviceCatalog()
  const account = useResource('shared-device-account', getMe)
  const device = useResource(`shared-device:${deviceId ?? ''}`, () => getDevice(deviceId!), 10000, Boolean(deviceId))
  const telemetry = useDeviceTelemetry(device.data?.id)
  const events = useResource(`shared-device-events:${deviceId ?? ''}`, () => listEvents({ device_id: deviceId!, limit: 100 }), 10000, Boolean(deviceId))
  const [editing, setEditing] = useState(false)
  const draft = useDeviceFormDraft('edit', deviceId)
  useEffect(() => { setEditing(false) }, [deviceId])
  const tab = normalizeDetail(params.get('detail'))
  const channel = normalizeChannel(params.get('channel')) ?? 'vibration'
  const legacyDevice = params.get('device')
  if (!deviceId && legacyDevice) {
    const next = new URLSearchParams(params)
    next.delete('device')
    return <Navigate replace to={`/manage/devices/${encodeURIComponent(legacyDevice)}${next.size ? `?${next}` : ''}`} />
  }
  return (
    <div className="management-detail">
      <PageHeading
        title="设备详情"
        meta={<span>查看这台设备的实时数据、诊断记录与维护信息</span>}
        actions={<Space wrap>
          <Button onClick={() => navigate(account.data?.role === 'admin' ? '/admin/devices' : '/dashboard')}>{account.data?.role === 'admin' ? '设备列表' : '返回工厂'}</Button>
          {device.data && <Button onClick={() => navigate(`/tools/diagnosis?device=${encodeURIComponent(device.data!.id)}`)}>智能诊断</Button>}
          {device.data && account.data?.role === 'admin' && <Button type="primary" onClick={() => setEditing(true)}>编辑设备</Button>}
        </Space>}
      />
      <Card className="management-device-selector">
        <label htmlFor="management-device-choice">选择设备</label>
        <Select
          id="management-device-choice" aria-label="选择详情设备" showSearch
          optionFilterProp="label" loading={catalog.loading} value={deviceId}
          placeholder="选择设备查看详细分析"
          onChange={(id) => navigate(`/manage/devices/${encodeURIComponent(id)}`)}
          options={(catalog.data ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))}
        />
        {catalog.error && <p className="management-hint">{catalog.error}</p>}
      </Card>
      <LoadState loading={Boolean(deviceId) && device.loading && !device.data} error={device.error} onRetry={device.refresh} empty={!deviceId} emptyText="选择一台设备，即可查看实时监测、健康历史、声学分析与数字孪生。">
        <DeviceAnalysisPanel
          device={device.data} telemetry={telemetry} tab={tab}
          onTab={(value) => update({ detail: value === 'realtime' ? undefined : value })}
          channel={channel} onChannel={(value) => update({ channel: value })}
          events={events.data ?? []} eventsLoading={events.loading} eventsError={events.error}
          onRefreshEvents={events.refresh}
          onSelectEvent={(id) => navigate(`/manage/records/${id}`)}
        />
      </LoadState>
      <DeviceEditor open={editing || Boolean(draft && device.data)} device={device.data} draft={draft} onClose={() => { if (draft) deviceFormDraftChannel.release(draft.actionId); setEditing(false) }} onSaved={() => { device.refresh(); catalog.refresh() }} />
    </div>
  )
}

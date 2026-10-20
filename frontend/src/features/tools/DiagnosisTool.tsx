import { Alert, Button, Select } from 'antd'
import DiagnosisPanel from '../factory/panels/DiagnosisPanel'
import { LoadState } from '../../components/BusinessUI'
import { useToolContext } from './useToolContext'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { recordDetailPath } from '../../services/workspaceMode'
import '../factory/factory.css'
export default function DiagnosisTool() {
  const context = useToolContext()
  const navigate = useSpatialNavigate()
  const { workspace, catalog, device, telemetry, event, selected, events, refresh } = context
  return <section className="surface task-workspace">
    <div className="task-context"><label htmlFor="diagnosis-device">诊断设备</label><Select id="diagnosis-device" aria-label="诊断设备" showSearch optionFilterProp="label" allowClear
      value={workspace.selectedDeviceId} placeholder="选择有有效采样的设备" onChange={id => workspace.setDevice(id)}
      options={(catalog.data ?? []).map(item => ({ value: item.id, label: `${item.name} · ${item.id}` }))} /></div>
    <LoadState loading={catalog.loading && !catalog.data} error={catalog.error} onRetry={catalog.refresh}>
      {workspace.selectedDeviceId && !catalog.loading && !device && <Alert showIcon type="warning" message={`设备 ${workspace.selectedDeviceId} 已不在当前目录中，无法发起新诊断。`}
        action={workspace.selectedEventId && <Button onClick={() => navigate(recordDetailPath(workspace.selectedEventId!))}>查看保存的诊断记录</Button>} />}
      <DiagnosisPanel device={device} telemetry={telemetry} event={event}
        deviceActiveEvent={(events.data ?? []).find(item => item.device_id === device?.id && ['consulting','pending','handling','observing'].includes(item.status_state ?? ''))}
        eventLoading={selected.loading} eventError={selected.error} onRefreshEvent={selected.refresh} onChanged={refresh} />
    </LoadState>
  </section>
}

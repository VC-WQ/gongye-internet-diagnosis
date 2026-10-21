import { useEffect, useState } from 'react'
import { Form, Input, InputNumber, Modal, Select, message } from 'antd'
import { createDevice, updateDevice, type Device } from '../../services/api'
import { errorText } from '../../hooks/useResource'
import { deviceFormDraftChannel, type DeviceFormDraft } from './deviceFormDraft'
import { validatePicoDeviceFields } from '../pico/core/uiActions'

export default function DeviceEditor({
  open, device, draft, onClose, onSaved,
}: {
  open: boolean
  device?: Device
  draft?: DeviceFormDraft
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (device) form.setFieldsValue({ id: device.id, name: device.name, device_type: device.device_type, health_score: device.health_score, status: device.status })
    // Background telemetry/catalog refresh must not overwrite an in-progress edit.
  }, [device?.id, form, open])
  useEffect(() => {
    if (!open || !draft || (draft.mode === 'edit' && device?.id !== draft.deviceId)) return
    if (!validatePicoDeviceFields(draft.fields, draft.mode)) { deviceFormDraftChannel.release(draft.actionId, '预填字段不符合设备表单要求。', false); return }
    // Merge only explicit fields. A second partial draft never erases user edits.
    form.setFieldsValue(draft.fields)
    const frame = requestAnimationFrame(() => {
      const missing = [['id', '设备编号'], ['name', '设备名称'], ['device_type', '设备类型']]
        .filter(([key]) => !form.getFieldValue(key)).map(([, label]) => label)
      deviceFormDraftChannel.acknowledge(draft.actionId, { missing })
    })
    return () => cancelAnimationFrame(frame)
  }, [draft?.actionId, device?.id, form, open])
  const submit = async (values: { id?: string; name: string; device_type: string; health_score?: number; status?: string }) => {
    setSaving(true)
    try {
      const data = { name: values.name.trim(), device_type: values.device_type, ...(values.health_score != null ? { health_score: values.health_score } : {}), ...(values.status ? { status: values.status } : {}) }
      if (device) await updateDevice(device.id, data)
      else await createDevice({ id: values.id!.trim(), ...data })
      message.success('设备已保存')
      onSaved()
      onClose()
    } catch (error) { message.error(errorText(error)) }
    finally { setSaving(false) }
  }
  return (
    <Modal
      title={device ? '编辑设备' : '新增设备'} open={open}
      onCancel={saving ? undefined : onClose} closable={!saving} maskClosable={!saving}
      onOk={() => form.submit()} confirmLoading={saving} cancelButtonProps={{ disabled: saving }}
      okText="保存" cancelText="取消"
    >
      <Form form={form} layout="vertical" onFinish={submit}>
        {draft && <p className="management-hint" role="status">Pico 已填入明确提供的字段。请补齐必填项并检查，点击保存后才会写入。</p>}
        <Form.Item name="id" label="设备编号" rules={[{ required: true, message: '请输入设备编号，例如 pump-003' }, { pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, message: '编号须为 1–64 位字母、数字、横线或下划线' }]}><Input disabled={Boolean(device)} /></Form.Item>
        <Form.Item name="name" label="设备名称" rules={[{ required: true, whitespace: true }, { max: 128 }]}><Input maxLength={128} /></Form.Item>
        <Form.Item name="device_type" label="设备类型" rules={[{ required: true }]}>
          <Select options={[{ value: 'pump', label: '离心泵' }, { value: 'motor', label: '驱动电机' }, { value: 'compressor', label: '空压机' }]} />
        </Form.Item>
        <Form.Item name="health_score" label="健康评分" rules={[{ validator: (_, value) => value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) ? Promise.resolve() : Promise.reject(new Error('健康评分须为 0–100 的有限数字')) }]}>
          <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="可选，0–100" />
        </Form.Item>
        <Form.Item name="status" label="设备状态"><Select allowClear placeholder="可选" options={[{ value: 'healthy', label: '正常' }, { value: 'degraded', label: '退化' }, { value: 'fault', label: '告警' }, { value: 'offline', label: '离线' }]} /></Form.Item>
      </Form>
    </Modal>
  )
}

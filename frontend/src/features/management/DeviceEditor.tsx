import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import { createDevice, updateDevice, type Device } from '../../services/api'
import { errorText } from '../../hooks/useResource'

export default function DeviceEditor({
  open, device, onClose, onSaved,
}: {
  open: boolean
  device?: Device
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (device) form.setFieldsValue({ name: device.name, device_type: device.device_type })
    // Background telemetry/catalog refresh must not overwrite an in-progress edit.
  }, [device?.id, form, open])
  const submit = async (values: { id?: string; name: string; device_type: string }) => {
    setSaving(true)
    try {
      if (device) await updateDevice(device.id, { name: values.name, device_type: values.device_type })
      else await createDevice({ id: values.id!.trim(), name: values.name.trim(), device_type: values.device_type })
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
        {!device && <Form.Item name="id" label="设备编号" rules={[{ required: true, whitespace: true, message: '请输入设备编号，例如 pump-003' }]}><Input /></Form.Item>}
        <Form.Item name="name" label="设备名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="device_type" label="设备类型" rules={[{ required: true }]}>
          <Select options={[{ value: 'pump', label: '离心泵' }, { value: 'motor', label: '驱动电机' }, { value: 'compressor', label: '空压机' }]} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

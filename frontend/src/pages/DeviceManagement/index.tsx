import { useResource } from '../../hooks/useResource'
import { LoadState, PageHeading, StatusTag } from '../../components/BusinessUI'
import { useEffect, useState } from 'react'
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd'
import { createDevice, deleteDevice, getDevices, updateDevice, type Device } from '../../services/api'

const TYPE_LABEL: Record<string, string> = { pump: '泵', motor: '电机', compressor: '空压机' }

export default function DeviceManagement() {
  const resource = useResource<Device[]>('DeviceManagement', getDevices)
  const devices = resource.data ?? []
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const load = resource.refresh

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setOpen(true)
  }
  const openEdit = (d: Device) => {
    setEditing(d)
    form.setFieldsValue({ name: d.name, device_type: d.device_type, status: d.status, health_score: d.health_score })
    setOpen(true)
  }

  const submit = async (values: { id?: string; name: string; device_type: string; status?: string; health_score?: number }) => {
    setLoading(true)
    try {
      if (editing) {
        await updateDevice(editing.id, values)
      } else {
        await createDevice({ id: values.id!, name: values.name, device_type: values.device_type })
      }
      message.success('保存成功')
      setOpen(false)
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail ?? '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const onDelete = async (id: string) => {
    try {
      await deleteDevice(id)
      message.success('已删除')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail ?? '删除失败')
    }
  }

  const columns = [
    { title: '设备ID', dataIndex: 'id' },
    { title: '名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'device_type', render: (t: string) => TYPE_LABEL[t] ?? t },
    { title: '状态', dataIndex: 'status', render: (s: string) => <StatusTag status={s} /> },
    {
      title: '健康分',
      dataIndex: 'health_score',
      render: (v: number) => <span style={{ fontWeight: 700, color: v > 85 ? "var(--status-ok)" : v >= 60 ? "var(--status-warn)" : "var(--status-danger)" }}>{Math.round(v)}</span>,
    },
    {
      title: '操作',
      render: (_: unknown, d: Device) => (
        <Space>
          <Button size="small" onClick={() => openEdit(d)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该设备？" onConfirm={() => onDelete(d.id)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card title="设备管理" extra={<Button type="primary" onClick={openCreate}>新增设备</Button>}>
      <Table rowKey="id" dataSource={devices} columns={columns} pagination={false} />
      <Modal
        title={editing ? '编辑设备' : '新增设备'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          {!editing && (
            <Form.Item name="id" label="设备ID" rules={[{ required: true, message: '如 pump-003' }]}>
              <Input />
            </Form.Item>
          )}
          <Form.Item name="name" label="设备名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="device_type" label="设备类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'pump', label: '泵' },
                { value: 'motor', label: '电机' },
                { value: 'compressor', label: '空压机' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

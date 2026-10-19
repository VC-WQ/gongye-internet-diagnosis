import { useResource } from '../../hooks/useResource'
import { LoadState, PageHeading, StatusTag } from '../../components/BusinessUI'
import { useEffect, useState } from 'react'
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, message } from 'antd'
import { createUser, deleteUser, listUsers, updateUser, type AuthUser } from '../../services/api'

export default function UserManagement() {
  const resource = useResource<AuthUser[]>('UserManagement', listUsers)
  const users = resource.data ?? []
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const load = resource.refresh

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setOpen(true)
  }
  const openEdit = (u: AuthUser) => {
    setEditing(u)
    form.setFieldsValue({ username: u.username, role: u.role, is_active: u.is_active })
    setOpen(true)
  }

  const submit = async (values: { username?: string; password?: string; role: string; is_active?: boolean }) => {
    setLoading(true)
    try {
      if (editing) {
        await updateUser(editing.id, {
          role: values.role,
          is_active: values.is_active,
          password: values.password || undefined,
        })
      } else {
        await createUser({ username: values.username!, password: values.password!, role: values.role })
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

  const onDelete = async (id: number) => {
    try {
      await deleteUser(id)
      message.success('已删除')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail ?? '删除失败')
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username' },
    {
      title: '角色',
      dataIndex: 'role',
      render: (r: string) => <Tag color={r === 'admin' ? 'red' : 'blue'}>{r === 'admin' ? '管理员' : '普通用户'}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      render: (_: unknown, u: AuthUser) => (
        <Space>
          <Button size="small" onClick={() => openEdit(u)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该用户？" onConfirm={() => onDelete(u.id)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card title="用户管理" extra={<Button type="primary" onClick={openCreate}>新增用户</Button>}>
      <Table rowKey="id" dataSource={users} columns={columns} pagination={false} />
      <Modal
        title={editing ? '编辑用户' : '新增用户'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          {!editing && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}>
                <Input />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
                <Input.Password />
              </Form.Item>
            </>
          )}
          {editing && (
            <Form.Item name="password" label="重置密码（留空不改）">
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'user', label: '普通用户' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Form.Item>
          {editing && (
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  )
}
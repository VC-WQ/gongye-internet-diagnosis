import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd'
import { useResource, errorText } from '../../hooks/useResource'
import { usePageQuery } from '../../hooks/usePageQuery'
import { LoadState } from '../../components/BusinessUI'
import { createUser, deleteUser, getMe, listUsers, updateUser, type AuthUser } from '../../services/api'
import { BatchControls, BatchResult, type DeleteFailure } from '../../features/management/BatchControls'
import { deleteSelected } from '../../features/management/batchDelete'
import { useTableMotion } from '../../motion/useTableMotion'

export default function UserManagement() {
  const resource = useResource<AuthUser[]>('admin-users', listUsers)
  const account = useResource('admin-current-account', getMe)
  const { params, update } = usePageQuery()
  const keyword = params.get('q') ?? ''
  const role = params.get('role') ?? 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const selectedId = Number(params.get('user')) || undefined
  const selectedUser = resource.data?.find((user) => user.id === selectedId)
  const creating = params.get('create') === 'user'
  const [editingList, setEditingList] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ deleted: number; failed: DeleteFailure[] }>({ deleted: 0, failed: [] })
  const [form] = Form.useForm()
  const users = useMemo(() => (resource.data ?? []).filter((user) =>
    user.username.toLowerCase().includes(keyword.trim().toLowerCase()) && (role === 'all' || user.role === role),
  ), [keyword, resource.data, role])
  const tableMotion = useTableMotion(`${editingList}:${users.slice((page - 1) * 10, page * 10).map(item => item.id).join('|')}`)
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(users.length / 10))
    if (resource.data && !resource.loading && page > lastPage)
      update({ page: lastPage > 1 ? String(lastPage) : undefined }, true)
  }, [page, resource.data, resource.loading, users.length])
  useEffect(() => {
    form.resetFields()
    if (selectedUser) form.setFieldsValue({ role: selectedUser.role, is_active: selectedUser.is_active })
    else form.setFieldsValue({ role: 'user' })
  }, [creating, form, selectedUser])
  const close = () => update({ user: undefined, create: undefined })
  const openUser = (user: AuthUser) => update({ user: String(user.id), create: undefined })
  const submit = async (values: { username?: string; password?: string; role: string; is_active?: boolean }) => {
    setSaving(true)
    try {
      if (selectedUser) await updateUser(selectedUser.id, { role: values.role, is_active: values.is_active, password: values.password || undefined })
      else await createUser({ username: values.username!.trim(), password: values.password!, role: values.role })
      message.success('用户已保存')
      close()
      resource.refresh()
      account.refresh()
    } catch (error) { message.error(errorText(error)) }
    finally { setSaving(false) }
  }
  const remove = async () => {
    setBusy(true)
    try {
      const value = await deleteSelected(selected, deleteUser)
      setSelected(value.failed.map(({ id }) => id))
      setResult({ deleted: value.deleted.length, failed: value.failed })
      if (!value.failed.length) message.success(`已删除 ${value.deleted.length} 个用户`)
      resource.refresh()
    } finally { setBusy(false) }
  }
  const cancel = () => { setEditingList(false); setSelected([]); setResult({ deleted: 0, failed: [] }) }
  return (
    <Card className="management-list">
      <div className="management-toolbar">
        <Space wrap>
          <Input.Search aria-label="搜索用户" placeholder="搜索用户名" allowClear value={keyword} onChange={(event) => update({ q: event.target.value || undefined, page: undefined }, true)} />
          <Select aria-label="用户角色筛选" value={role} onChange={(value) => update({ role: value === 'all' ? undefined : value, page: undefined })} options={[{ value: 'all', label: '全部角色' }, { value: 'admin', label: '管理员' }, { value: 'user', label: '普通用户' }]} />
        </Space>
        <Space wrap>
          <BatchControls editing={editingList} count={selected.length} busy={busy} onEdit={() => setEditingList(true)} onCancel={cancel} onDelete={remove} />
          {!editingList && <Button type="primary" onClick={() => update({ create: 'user', user: undefined })}>新增用户</Button>}
        </Space>
      </div>
      <p className="management-hint">{editingList ? '当前登录账号不能删除。批量选择与单用户编辑独立。' : '点击用户行查看并编辑角色、启停状态或密码。'}</p>
      <BatchResult {...result} />
      <LoadState loading={resource.loading && !resource.data} error={resource.error} onRetry={resource.refresh}>
        <div ref={tableMotion}><Table<AuthUser>
          rowKey="id" dataSource={users} scroll={{ x: 550 }} loading={busy}
          rowSelection={editingList ? {
            selectedRowKeys: selected, preserveSelectedRowKeys: true,
            onChange: (keys) => setSelected(keys.map(Number)),
            getCheckboxProps: (user) => ({ disabled: !account.data || user.id === account.data.id }),
          } : undefined}
          onRow={(user) => ({
            tabIndex: editingList ? undefined : 0, className: editingList ? '' : 'management-row-link',
            onClick: () => { if (!editingList) openUser(user) },
            onKeyDown: (event) => { if (!editingList && event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openUser(user) } },
            'aria-label': editingList ? undefined : `查看用户 ${user.username}`,
          })}
          pagination={{ current: page, pageSize: 10, total: users.length, showSizeChanger: false, onChange: (value) => update({ page: value > 1 ? String(value) : undefined }) }}
          columns={[
            { title: '编号', dataIndex: 'id', width: 80 }, { title: '用户名', dataIndex: 'username' },
            { title: '角色', dataIndex: 'role', render: (value) => <Tag color={value === 'admin' ? 'red' : 'blue'}>{value === 'admin' ? '管理员' : '普通用户'}</Tag> },
            { title: '状态', dataIndex: 'is_active', render: (value) => <Tag color={value ? 'success' : 'default'}>{value ? '启用' : '停用'}</Tag> },
          ]}
        /></div>
      </LoadState>
      <Modal
        title={creating ? '新增用户' : `用户详情 · ${selectedUser?.username ?? selectedId ?? ''}`}
        open={creating || Boolean(selectedId)} onCancel={saving ? undefined : close} closable={!saving} maskClosable={!saving}
        onOk={() => form.submit()} okText="保存" cancelText="取消" confirmLoading={saving}
        okButtonProps={{ disabled: !creating && !selectedUser }} cancelButtonProps={{ disabled: saving }}
      >
        <LoadState loading={Boolean(selectedId) && resource.loading} error={resource.error} empty={Boolean(selectedId) && !resource.loading && !selectedUser} emptyText="用户不存在，或已被删除" onRetry={resource.refresh}>
          <Form form={form} layout="vertical" onFinish={submit}>
            {creating ? <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, whitespace: true }]}><Input /></Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}><Input.Password autoComplete="new-password" /></Form.Item>
            </> : <>
              <p className="management-hint">编号 {selectedUser?.id} · {selectedUser?.username}</p>
              <Form.Item name="password" label="重置密码（留空不改）" rules={[{ min: 6, message: '新密码至少 6 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
            </>}
            <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]} /></Form.Item>
            {!creating && <Form.Item name="is_active" label="账号启用" valuePropName="checked"><Switch /></Form.Item>}
          </Form>
        </LoadState>
      </Modal>
    </Card>
  )
}

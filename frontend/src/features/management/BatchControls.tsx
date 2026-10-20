import { Alert, Button, Modal, Space } from 'antd'
import { errorText } from '../../hooks/useResource'

export interface DeleteFailure {
  id: string | number
  error: unknown
}

export function BatchControls({
  editing, count, busy, onEdit, onCancel, onDelete,
}: {
  editing: boolean
  count: number
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onDelete: () => Promise<void>
}) {
  if (!editing) return <Button onClick={onEdit}>编辑列表</Button>
  return (
    <Space wrap className="management-batch" aria-label="批量操作">
      <span>已选择 {count} 项</span>
      <Button
        danger disabled={!count || busy} loading={busy}
        onClick={() => Modal.confirm({
          title: `删除选中的 ${count} 项？`,
          content: '删除不可撤销。逐项调用实际删除接口，失败项将保留以便重试。',
          okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
          onOk: onDelete,
        })}
      >批量删除</Button>
      <Button disabled={busy} onClick={onCancel}>取消编辑</Button>
    </Space>
  )
}

export function BatchResult({ deleted, failed }: { deleted: number; failed: DeleteFailure[] }) {
  if (!failed.length) return null
  return (
    <Alert
      className="management-batch-result" type="warning" showIcon
      message={`已删除 ${deleted} 项，${failed.length} 项失败；失败项仍被选中`}
      description={
        <ul>{failed.map(({ id, error }) => <li key={id}>{id}：{errorText(error)}</li>)}</ul>
      }
    />
  )
}

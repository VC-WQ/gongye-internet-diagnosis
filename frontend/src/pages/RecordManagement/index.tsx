import { useState } from 'react'
import {
  Button,
  Card,
  Descriptions,
  Modal,
  Popconfirm,
  Space,
  Table,
  message,
} from 'antd'
import { deleteRecord, getRecord, listRecords } from '../../services/api'
import { errorText, useResource } from '../../hooks/useResource'
import { usePageQuery } from '../../hooks/usePageQuery'
import {
  formatTime,
  LoadState,
  numberText,
  StatusTag,
} from '../../components/BusinessUI'
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
  const page = Math.max(1, Number(params.get('page')) || 1)
  const selectedId = Number(params.get('record')) || undefined
  const data = useResource(`admin-records:${page}`, () =>
    listRecords({ offset: (page - 1) * 10, limit: 10 }),
  )
  const detail = useResource(
    `admin-record:${selectedId}`,
    () => getRecord(selectedId!),
    0,
    Boolean(selectedId),
  )
  const [deleting, setDeleting] = useState<number>()
  const remove = async (id: number) => {
    setDeleting(id)
    try {
      await deleteRecord(id)
      message.success('已删除')
      data.refresh()
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setDeleting(undefined)
    }
  }
  return (
    <Card title="诊断记录管理">
      <LoadState
        loading={data.loading}
        error={data.error}
        onRetry={data.refresh}
      >
        <Table<RecordItem>
          rowKey="id"
          dataSource={(data.data?.items ?? []) as RecordItem[]}
          scroll={{ x: 800 }}
          pagination={{
            current: page,
            pageSize: 10,
            total: data.data?.total ?? 0,
            onChange: (value) => update({ page: String(value) }),
          }}
          columns={[
            { title: '编号', dataIndex: 'id' },
            { title: '设备', dataIndex: 'device_id' },
            {
              title: '故障类型',
              dataIndex: 'fault_label',
              render: (v) => v ?? '—',
            },
            {
              title: '置信度',
              dataIndex: 'confidence',
              render: (v) =>
                typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—',
            },
            {
              title: '健康评分',
              dataIndex: 'health_score',
              render: (v) => numberText(v, 0),
            },
            {
              title: '状态',
              dataIndex: 'status_state',
              render: (v) => <StatusTag status={v} event />,
            },
            { title: '时间', dataIndex: 'timestamp', render: formatTime },
            {
              title: '操作',
              render: (_, item) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => update({ record: String(item.id) })}
                  >
                    详情
                  </Button>
                  <Popconfirm
                    title="删除这条诊断记录？"
                    onConfirm={() => remove(item.id)}
                  >
                    <Button danger size="small" disabled={deleting != null}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </LoadState>
      <Modal
        title="诊断记录"
        open={Boolean(selectedId)}
        onCancel={() => update({ record: undefined })}
        footer={null}
        width={700}
      >
        <LoadState
          loading={detail.loading}
          error={detail.error}
          onRetry={detail.refresh}
        >
          {detail.data && (
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="设备">
                {detail.data.device_id}
              </Descriptions.Item>
              <Descriptions.Item label="故障类型">
                {detail.data.fault_label ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="健康评分">
                {numberText(detail.data.health_score)}
              </Descriptions.Item>
              <Descriptions.Item label="摘要">
                {detail.data.report?.summary ?? '暂无摘要'}
              </Descriptions.Item>
            </Descriptions>
          )}
        </LoadState>
      </Modal>
    </Card>
  )
}

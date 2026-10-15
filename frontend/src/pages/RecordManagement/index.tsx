import { useEffect, useState } from 'react'
import { Button, Card, Descriptions, Modal, Popconfirm, Space, Table, Tag, message } from 'antd'
import { deleteRecord, getRecord, listRecords } from '../../services/api'

interface RecordItem {
  id: number
  device_id: string
  fault_type: string
  fault_label: string
  confidence: number
  health_score: number
  status_state: string
  severity: string
  timestamp: string
}

export default function RecordManagement() {
  const [data, setData] = useState<RecordItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)

  const load = (p = page) => {
    listRecords({ offset: (p - 1) * 10, limit: 10 }).then((r) => {
      setData(r.items as RecordItem[])
      setTotal(r.total)
    })
  }
  useEffect(() => {
    load(1)
  }, [])

  const onView = async (id: number) => {
    const d = await getRecord(id)
    setDetail(d)
  }
  const onDelete = async (id: number) => {
    try {
      await deleteRecord(id)
      message.success('已删除')
      load()
    } catch {
      message.error('删除失败')
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '设备', dataIndex: 'device_id' },
    { title: '故障类型', dataIndex: 'fault_label', render: (v: string) => <Tag color="orange">{v ?? '—'}</Tag> },
    { title: '置信度', dataIndex: 'confidence', render: (v: number | null) => (v != null ? (v * 100).toFixed(1) + '%' : '—') },
    { title: '健康分', dataIndex: 'health_score', render: (v: number | null) => (v != null ? Math.round(v) : '—') },
    { title: '时间', dataIndex: 'timestamp', render: (v: string) => (v ? new Date(v).toLocaleString() : '—') },
    {
      title: '操作',
      render: (_: unknown, r: RecordItem) => (
        <Space>
          <Button size="small" onClick={() => onView(r.id)}>
            详情
          </Button>
          <Popconfirm title="确认删除该记录？" onConfirm={() => onDelete(r.id)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card title="诊断记录管理">
      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        pagination={{ current: page, pageSize: 10, total, onChange: (p) => { setPage(p); load(p) } }}
      />
      <Modal title="诊断记录详情" open={!!detail} onCancel={() => setDetail(null)} footer={null} width={700}>
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="设备">{String(detail.device_id)}</Descriptions.Item>
            <Descriptions.Item label="故障类型">{String(detail.fault_label ?? '—')}</Descriptions.Item>
            <Descriptions.Item label="置信度">{detail.confidence != null ? ((detail.confidence as number) * 100).toFixed(1) + '%' : '—'}</Descriptions.Item>
            <Descriptions.Item label="健康分">{detail.health_score != null ? String(Math.round(detail.health_score as number)) : '—'}</Descriptions.Item>
            <Descriptions.Item label="报告摘要">
              <div style={{ whiteSpace: 'pre-wrap' }}>{String(((detail.report as Record<string, unknown> | undefined)?.summary) ?? '—')}</div>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Card>
  )
}
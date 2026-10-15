import { useEffect, useState } from 'react'
import { Button, Card, Empty, Space, Tag, message } from 'antd'
import {
  acceptThresholdSuggestion,
  listThresholdSuggestions,
  rejectThresholdSuggestion,
} from '../../services/api'

interface Suggestion {
  id: number
  device_id: string
  old_value: number
  new_value: number
  reason: string
  status: string
  accepted_by: string | null
  created_at: string | null
  accepted_at: string | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  accepted: '已采纳',
  rejected: '已拒绝',
}
const STATUS_COLOR: Record<string, string> = {
  pending: 'orange',
  accepted: 'green',
  rejected: 'default',
}

export default function ThresholdSuggestions() {
  const [list, setList] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    listThresholdSuggestions().then(setList).catch(console.error)
  }, [])

  const onAct = async (id: number, type: 'accept' | 'reject') => {
    setLoading(true)
    try {
      if (type === 'accept') {
        await acceptThresholdSuggestion(id, 'operator')
        message.success('已采纳')
      } else {
        await rejectThresholdSuggestion(id, 'operator')
        message.success('已拒绝')
      }
      setList(await listThresholdSuggestions())
    } catch {
      message.error('操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="动态阈值建议">
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {list.length === 0 ? (
          <Empty description="暂无阈值建议（注入演示数据后可见）" />
        ) : (
          list.map((s) => (
            <Card key={s.id} size="small" type="inner">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <Space>
                    <span style={{ fontWeight: 600 }}>{s.device_id}</span>
                    <Tag color={STATUS_COLOR[s.status]}>{STATUS_LABEL[s.status] ?? s.status}</Tag>
                  </Space>
                  <div style={{ marginTop: 6, fontWeight: 600 }}>
                    建议：{s.old_value} → {s.new_value}
                  </div>
                  <div style={{ color: '#78879b', fontSize: 13, marginTop: 4 }}>{s.reason}</div>
                </div>
                {s.status === 'pending' && (
                  <Space>
                    <Button type="primary" size="small" loading={loading} onClick={() => onAct(s.id, 'accept')}>
                      采纳
                    </Button>
                    <Button danger size="small" loading={loading} onClick={() => onAct(s.id, 'reject')}>
                      拒绝
                    </Button>
                  </Space>
                )}
              </div>
            </Card>
          ))
        )}
      </Space>
    </Card>
  )
}
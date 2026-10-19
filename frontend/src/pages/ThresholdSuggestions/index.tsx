import { useState } from 'react'
import { Button, Card, Popconfirm, Space, Tag, message } from 'antd'
import {
  acceptThresholdSuggestion,
  listThresholdSuggestions,
  rejectThresholdSuggestion,
} from '../../services/api'
import { useResource, errorText } from '../../hooks/useResource'
import { LoadState } from '../../components/BusinessUI'
interface Suggestion {
  id: number
  device_id: string
  old_value: number
  new_value: number
  reason: string
  status: string
}
export default function ThresholdSuggestions() {
  const resource = useResource<Suggestion[]>(
    'threshold-suggestions',
    listThresholdSuggestions,
  )
  const [acting, setActing] = useState<number>()
  const act = async (id: number, accept: boolean) => {
    if (acting != null) return
    setActing(id)
    try {
      const user =
        JSON.parse(localStorage.getItem('user') ?? '{}').username ?? 'operator'
      if (accept) await acceptThresholdSuggestion(id, user)
      else await rejectThresholdSuggestion(id, user)
      message.success(accept ? '已采纳' : '已拒绝')
      resource.refresh()
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setActing(undefined)
    }
  }
  return (
    <Card title="阈值建议">
      <LoadState
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.refresh}
        empty={!resource.data?.length}
        emptyText="暂无阈值建议"
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {resource.data?.map((item) => (
            <div className="surface" key={item.id}>
              <div className="section-header">
                <Space>
                  <strong>{item.device_id}</strong>
                  <Tag>
                    {(
                      {
                        pending: '待处理',
                        accepted: '已采纳',
                        rejected: '已拒绝',
                      } as Record<string, string>
                    )[item.status] ?? item.status}
                  </Tag>
                </Space>
                {item.status === 'pending' && (
                  <Space>
                    <Popconfirm
                      title={`将阈值从 ${item.old_value} 调整为 ${item.new_value}？`}
                      onConfirm={() => act(item.id, true)}
                    >
                      <Button
                        type="primary"
                        size="small"
                        disabled={acting != null}
                      >
                        采纳
                      </Button>
                    </Popconfirm>
                    <Button
                      size="small"
                      disabled={acting != null}
                      onClick={() => act(item.id, false)}
                    >
                      拒绝
                    </Button>
                  </Space>
                )}
              </div>
              <p>
                {item.old_value} → {item.new_value}
              </p>
              <p className="page-meta">{item.reason}</p>
            </div>
          ))}
        </Space>
      </LoadState>
    </Card>
  )
}

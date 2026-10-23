import { Card, Table } from 'antd'
import { getSelfEvalMetrics, getThresholdEffects } from '../../services/api'
import { useResource } from '../../hooks/useResource'
import { LoadState, numberText } from '../../components/BusinessUI'
interface Effect {
  suggestion_id: number
  device_id: string
  old_value: number
  new_value: number
  false_alarms_before: number
  false_alarms_after: number
  reduction: number
}
export default function SystemEval() {
  const metrics = useResource('self-eval', getSelfEvalMetrics)
  const effects = useResource<Effect[]>(
    'threshold-effects',
    getThresholdEffects,
  )
  const pct = (value: unknown) =>
    typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—'
  const available = metrics.data && metrics.data.total > 0
  return (
    <>
      <LoadState
        loading={metrics.loading}
        error={metrics.error}
        onRetry={metrics.refresh}
        empty={!available}
        emptyText="暂无可评估的诊断记录"
      >
        <div className="metric-strip">
          <div>
            <span>诊断准确率</span>
            <strong>{pct(metrics.data?.accuracy)}</strong>
          </div>
          <div>
            <span>误报率</span>
            <strong>{pct(metrics.data?.false_alarm_rate)}</strong>
          </div>
          <div>
            <span>漏报率</span>
            <strong>{pct(metrics.data?.miss_rate)}</strong>
          </div>
          <div>
            <span>平均诊断延迟</span>
            <strong>{numberText(metrics.data?.avg_latency_seconds)}</strong>
            <small>秒</small>
          </div>
        </div>
      </LoadState>
      <Card title="阈值效果">
        <LoadState
          loading={effects.loading}
          error={effects.error}
          onRetry={effects.refresh}
        >
          <Table<Effect>
            rowKey="suggestion_id"
            dataSource={effects.data ?? []}
            scroll={{ x: 650 }}
            pagination={false}
            locale={{ emptyText: '暂无阈值效果记录' }}
            columns={[
              { title: '设备', dataIndex: 'device_id' },
              {
                title: '阈值调整',
                render: (_, r) => `${r.old_value} → ${r.new_value}`,
              },
              { title: '采纳前误报', dataIndex: 'false_alarms_before' },
              { title: '采纳后误报', dataIndex: 'false_alarms_after' },
              { title: '减少量', dataIndex: 'reduction' },
            ]}
          />
        </LoadState>
      </Card>
    </>
  )
}

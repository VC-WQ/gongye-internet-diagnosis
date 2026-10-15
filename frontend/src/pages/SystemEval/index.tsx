import { useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, Table } from 'antd'
import { getSelfEvalMetrics, getThresholdEffects } from '../../services/api'

interface Metrics {
  total: number
  accuracy: number
  false_alarm_rate: number
  miss_rate: number
  avg_latency_seconds: number
  threshold_calibration_count: number
}

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
  const [metrics, setMetrics] = useState<Metrics>()
  const [effects, setEffects] = useState<Effect[]>([])

  useEffect(() => {
    getSelfEvalMetrics().then(setMetrics).catch(console.error)
    getThresholdEffects().then(setEffects).catch(console.error)
  }, [])

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`

  const columns = [
    { title: '设备', dataIndex: 'device_id' },
    {
      title: '阈值建议',
      render: (_: unknown, r: Effect) => `${r.old_value} → ${r.new_value}`,
    },
    { title: '采纳前误报', dataIndex: 'false_alarms_before' },
    { title: '采纳后误报', dataIndex: 'false_alarms_after' },
    {
      title: '减少量',
      dataIndex: 'reduction',
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#52c41a' : '#94a3b8', fontWeight: v > 0 ? 600 : 400 }}>
          {v}
        </span>
      ),
    },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="诊断准确率"
              value={pct(metrics?.accuracy ?? 0)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="误报率" value={pct(metrics?.false_alarm_rate ?? 0)} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="漏报率" value={pct(metrics?.miss_rate ?? 0)} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="平均诊断延迟"
              value={metrics?.avg_latency_seconds ?? 0}
              suffix="秒"
            />
          </Card>
        </Col>
      </Row>

      <Card title="阈值效果跟踪">
        <Table
          rowKey="suggestion_id"
          dataSource={effects}
          columns={columns}
          pagination={false}
          locale={{ emptyText: '暂无阈值效果数据（注入演示数据后可见）' }}
        />
      </Card>
    </div>
  )
}
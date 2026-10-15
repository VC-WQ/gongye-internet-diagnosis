import { useEffect, useState } from 'react'
import { Button, Card, Descriptions, Radio, Select, Space, Tag, message } from 'antd'
import { getDevices, injectFault, type Device } from '../../services/api'

// 故障注入模式（概念演示版：直接设置设备健康状态，注入后可选正常模式一键复位）
const MODES = [
  { value: 'normal', label: '正常', color: 'green', desc: '健康分 95' },
  { value: 'degradation', label: '退化', color: 'orange', desc: '健康分 70' },
  { value: 'fault', label: '故障', color: 'red', desc: '健康分 45' },
]

const STATUS_LABEL: Record<string, string> = {
  healthy: '正常',
  degraded: '退化',
  fault: '告警',
  offline: '离线',
}

export default function FaultInjection() {
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string>()
  const [mode, setMode] = useState('degradation')
  const [result, setResult] = useState<Device>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getDevices().then((d) => {
      setDevices(d)
      if (d.length > 0) setDeviceId(d[0].id)
    })
  }, [])

  const onInject = async () => {
    if (!deviceId) return
    setLoading(true)
    try {
      const r = await injectFault(deviceId, mode)
      setResult(r)
      message.success('故障场景已注入')
    } catch {
      message.error('注入失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Card title="故障注入面板" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <span style={{ marginRight: 8 }}>设备：</span>
            <Select
              style={{ width: 240 }}
              value={deviceId}
              onChange={setDeviceId}
              options={devices.map((d) => ({ value: d.id, label: `${d.name}（${d.id}）` }))}
            />
          </div>
          <div>
            <span style={{ marginRight: 8 }}>模式：</span>
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => (
                <Radio.Button key={m.value} value={m.value}>
                  {m.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            说明：概念演示版简化为直接设置健康状态，故障注入后可选正常模式一键复位
          </div>
          <Button type="primary" loading={loading} onClick={onInject}>
            注入场景
          </Button>
        </Space>
      </Card>

      {result && (
        <Card title="注入结果">
          <Descriptions column={3} bordered size="small">
            <Descriptions.Item label="设备">{result.name}</Descriptions.Item>
            <Descriptions.Item label="健康评分">
              <span style={{ fontWeight: 700 }}>{Math.round(result.health_score)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={result.status === 'fault' ? 'red' : result.status === 'degraded' ? 'orange' : 'green'}>
                {STATUS_LABEL[result.status] ?? result.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="边缘自检">
              {(result.edge_anomaly_score * 100).toFixed(1)}%
            </Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 12 }}>
            返回「设备大屏」即可看到该设备卡片状态变化
          </div>
        </Card>
      )}
    </div>
  )
}
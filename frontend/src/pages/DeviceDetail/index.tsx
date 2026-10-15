import { useEffect, useState } from 'react'
import { Button, Card, Descriptions, Empty, Space, Spin, Tabs, Tag } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import {
  getAcousticFusion,
  getAcousticSpectrum,
  getDevice,
  getDeviceWindow,
  getHealthHistory,
  getTimelineDevice,
  getTimelineEvent,
  type Device,
} from '../../services/api'

const TYPE_LABEL: Record<string, string> = { pump: '泵', motor: '电机', compressor: '空压机' }
const STATUS_LABEL: Record<string, string> = {
  healthy: '正常',
  degraded: '退化',
  fault: '告警',
  offline: '离线',
}
const STATUS_COLOR: Record<string, string> = {
  healthy: 'green',
  degraded: 'orange',
  fault: 'red',
  offline: 'default',
}

function healthColor(score: number): string {
  if (score > 85) return '#52c41a'
  if (score >= 60) return '#faad14'
  return '#f5222d'
}

const LATENT_CHANNELS: Array<{ key: string; name: string; color: string }> = [
  { key: 'latent_wear', name: '磨损', color: '#f5222d' },
  { key: 'latent_heat', name: '热积累', color: '#fa8c16' },
  { key: 'latent_efficiency', name: '效率', color: '#52c41a' },
]

// 实时传感器通道 -> 中文名 + 物理单位
const CHANNEL_LABEL: Record<string, string> = {
  vibration: '振动 (g)',
  temperature: '温度 (℃)',
  current: '电流 (A)',
  pressure: '压力 (bar)',
  speed: '转速 (rpm)',
  acoustic: '声压 (dB)',
}

export default function DeviceDetail() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()
  const [device, setDevice] = useState<Device>()
  const [windowData, setWindowData] = useState<Array<Record<string, number>>>([])
  const [latent, setLatent] = useState<Record<string, number[]>>()
  const [acoustic, setAcoustic] =
    useState<{ freq: number[]; time: number[]; spectrum: number[][]; coherence: number }>()
  const [fusion, setFusion] = useState<{ cross_modal_agreement: number; anomaly_score: number }>()
  const [healthHistory, setHealthHistory] = useState<Array<{ timestamp: string; health_score: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!deviceId) return
    getDevice(deviceId).then(setDevice).catch(console.error).finally(() => setLoading(false))
    const load = () =>
      getDeviceWindow(deviceId)
        .then((w) => {
          if (Array.isArray(w)) setWindowData(w)
        })
        .catch(console.error)
    load()
    const timer = setInterval(load, 3000) // 每 3 秒轮询实时曲线
    return () => clearInterval(timer)
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) return
    getTimelineDevice(deviceId)
      .then((d) => {
        const first = d.events?.[0]
        if (first) return getTimelineEvent(first.event_id, { simulate_latent: true })
      })
      .then((td) => td && setLatent(td.latent?.series))
      .catch(console.error)
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) return
    getAcousticSpectrum(deviceId).then(setAcoustic).catch(console.error)
    getAcousticFusion(deviceId).then(setFusion).catch(console.error)
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) return
    getHealthHistory(deviceId).then(setHealthHistory).catch(console.error)
  }, [deviceId])

  // 实时曲线：展示窗口内所有可用观测通道
  const channels = windowData.length > 0 ? Object.keys(windowData[0]) : []
  const rtOption = {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'value', name: '采样点' },
    yAxis: { type: 'value', name: '读数' },
    series: channels.map((ch) => ({
      name: CHANNEL_LABEL[ch] ?? ch,
      type: 'line',
      showSymbol: false,
      smooth: true,
      data: windowData.map((rec, i) => [i, rec[ch]]),
    })),
  }

  const latentChannels = latent ? Object.keys(latent) : []
  const latentOption = {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'value', name: '采样点' },
    yAxis: { type: 'value', name: '归一化隐状态值' },
    series: LATENT_CHANNELS.filter((c) => latent?.[c.key]?.length).map((c) => ({
      name: c.name,
      type: 'line',
      showSymbol: false,
      smooth: true,
      lineStyle: { color: c.color },
      data: (latent![c.key] as number[]).map((v, i) => [i, v]),
    })),
  }

  const acousticOption = acoustic
    ? {
        tooltip: { position: 'top' },
        grid: { left: 70, right: 20, top: 20, bottom: 70 },
        xAxis: { type: 'category', data: acoustic.time, name: '时间帧' },
        yAxis: { type: 'category', data: acoustic.freq, name: '频率(Hz)' },
        visualMap: {
          min: 0,
          max: 1,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
        },
        series: [
          {
            type: 'heatmap',
            data: acoustic.spectrum.flatMap((row, t) => row.map((v, f) => [t, f, v])),
            label: { show: false },
          },
        ],
      }
    : {}

  const historyOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: 30, bottom: 60 },
    xAxis: { type: 'category', data: healthHistory.map((h) => h.timestamp?.slice(5, 16) ?? '') },
    yAxis: { type: 'value', name: '健康评分 (0–100)', min: 0, max: 100 },
    series: [
      {
        name: '健康分',
        type: 'line',
        showSymbol: true,
        smooth: true,
        data: healthHistory.map((h) => h.health_score),
        lineStyle: { color: '#38bdf8' },
        markLine: {
          data: [{ yAxis: 60, name: '告警线' }],
          lineStyle: { color: '#f5222d', type: 'dashed' },
        },
      },
    ],
  }

  const tabs = [
    {
      key: 'realtime',
      label: '实时曲线',
      children: windowData.length > 0 ? (
        <ReactECharts theme="tech-dark" option={rtOption} style={{ height: 300 }} />
      ) : (
        <Empty description="暂无实时数据（请启动虚拟设备）" />
      ),
    },
    {
      key: 'latent',
      label: '数字孪生隐状态',
      children: latentChannels.length > 0 ? (
        <ReactECharts theme="tech-dark" option={latentOption} style={{ height: 280 }} />
      ) : (
        <Empty description="暂无隐状态数据" />
      ),
    },
    {
      key: 'acoustic',
      label: '声学频谱',
      children: acoustic ? (
        <div>
          <div style={{ marginBottom: 8, color: '#78879b' }}>
            声学特征与振动特征吻合度 {(acoustic.coherence * 100).toFixed(0)}%
          </div>
          <ReactECharts theme="tech-dark" option={acousticOption} style={{ height: 280 }} />
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(34, 211, 238, 0.06)',
              border: '1px solid rgba(34, 211, 238, 0.22)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf7', marginBottom: 6 }}>
              多模态融合（振动 + 声学）
            </div>
            {fusion ? (
              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.9 }}>
                跨模态一致性：
                <b
                  style={{
                    color: fusion.cross_modal_agreement >= 0.8 ? '#52c41a' : '#faad14',
                    fontSize: 15,
                  }}
                >
                  {(fusion.cross_modal_agreement * 100).toFixed(1)}%
                </b>
                <span>（越接近 100%，振动与声学两路信号越彼此印证）</span>
                <br />
                诊断可信度：
                <b style={{ color: '#22d3ee' }}>
                  {fusion.cross_modal_agreement >= 0.9
                    ? '高（两路信号高度吻合）'
                    : fusion.cross_modal_agreement >= 0.8
                      ? '中（信号基本吻合）'
                      : '待复核（信号存在分歧）'}
                </b>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>融合数据计算中…</div>
            )}
          </div>
        </div>
      ) : (
        <Empty description="暂无声学频谱数据" />
      ),
    },
    {
      key: 'history',
      label: '健康历史',
      children: healthHistory.length > 0 ? (
        <ReactECharts theme="tech-dark" option={historyOption} style={{ height: 300 }} />
      ) : (
        <Empty description="暂无健康历史（产生诊断事件后可见）" />
      ),
    },
  ]

  return (
    <Spin spinning={loading}>
      {device && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Space>
                <span style={{ fontSize: 20, fontWeight: 600 }}>{device.name}</span>
                <Tag>{TYPE_LABEL[device.device_type] ?? device.device_type}</Tag>
                <Tag color={STATUS_COLOR[device.status] ?? 'default'}>
                  {STATUS_LABEL[device.status] ?? device.status}
                </Tag>
              </Space>
              <div style={{ fontSize: 44, fontWeight: 700, color: healthColor(device.health_score) }}>
                {Math.round(device.health_score)}
                <span style={{ fontSize: 14, color: '#94a3b8' }}>/100</span>
              </div>
            </div>
            <Button onClick={() => navigate('/diagnose?tab=timeline')}>查看设备时间线</Button>
          </div>
          <Descriptions column={3} style={{ marginTop: 16 }}>
            <Descriptions.Item label="设备ID">{device.id}</Descriptions.Item>
            <Descriptions.Item label="边缘自检">
              {(device.edge_anomaly_score * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="振动阈值">{device.threshold_vibration ?? '—'}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}
      <Card>
        <Tabs items={tabs} />
      </Card>
    </Spin>
  )
}
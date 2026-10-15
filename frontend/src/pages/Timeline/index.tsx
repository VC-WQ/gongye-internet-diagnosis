import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Select, Space, Tag, Timeline as AntTimeline, Tooltip } from 'antd'
import ReactECharts from 'echarts-for-react'
import { getTimelineEvent, listEvents, type EventSummary } from '../../services/api'
import ChartNote from '../../components/ChartNote'

interface TimelineData {
  event_id: number
  device_id: string
  fault_type: string
  health_score: number
  status_state?: string
  trigger_time: string
  sensor: { channels: string[]; points: number; series: Record<string, number[]> }
  latent: { available: boolean; simulated: boolean; series: Record<string, number[]> }
  annotations: Array<{
    time: string | null
    type: string
    label: string
    reason?: string
    operator?: string
    from?: string
    to?: string
  }>
}

// 观测通道 -> 中文名 / 单位 / 配色（与后端 _OBSERVATION_KEYS 白名单一致）
const CHANNEL_META: Record<string, { name: string; unit: string; color: string }> = {
  vibration: { name: '振动', unit: 'g', color: '#22d3ee' },
  temperature: { name: '温度', unit: '℃', color: '#f5222d' },
  current: { name: '电流', unit: 'A', color: '#faad14' },
  pressure: { name: '压力', unit: 'bar', color: '#52c41a' },
  speed: { name: '转速', unit: 'rpm', color: '#a78bfa' },
  acoustic: { name: '声压', unit: 'dB', color: '#2dd4bf' },
  rpm: { name: '转速', unit: 'rpm', color: '#a78bfa' },
}

// 隐状态通道 -> 中文名与颜色
const LATENT_CHANNELS: Array<{ key: string; name: string; color: string }> = [
  { key: 'latent_wear', name: '磨损', color: '#f5222d' },
  { key: 'latent_heat', name: '热积累', color: '#fa8c16' },
  { key: 'latent_efficiency', name: '效率', color: '#52c41a' },
]

const ANNOTATION_COLOR: Record<string, string> = {
  trigger: 'red',
  state: 'gray',
  recovery: 'green',
}

// 横轴统一配置：采样点索引轴（Event.sensor_data 无逐点时间戳，故用采样序号，不做硬造时间对齐）
const axisCommon = (name: string, max: number) => ({
  type: 'value',
  name,
  nameLocation: 'middle' as const,
  nameGap: 32,
  nameTextStyle: { color: '#8fa3bd', fontSize: 12 },
  min: 0,
  max: Math.max(1, max - 1),
  axisLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.45)' } },
  axisTick: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.45)' } },
  axisLabel: {
    show: true,
    color: '#8fa3bd',
    fontSize: 11,
    formatter: (v: number) => String(Math.round(v)),
  },
  splitLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.12)' } },
})

export default function Timeline() {
  const [events, setEvents] = useState<EventSummary[]>([])
  const [eventId, setEventId] = useState<number>()
  const [data, setData] = useState<TimelineData>()
  const [simulate, setSimulate] = useState(false)
  const [channel, setChannel] = useState<string>('ALL')

  useEffect(() => {
    listEvents({ limit: 20 }).then((list) => {
      setEvents(list)
      if (list.length > 0) setEventId(list[0].id)
    })
  }, [])

  useEffect(() => {
    if (eventId == null) return
    setSimulate(false)
    getTimelineEvent(eventId)
      .then(async (d: TimelineData) => {
        // 隐状态未落库时自动补一份确定性演示曲线，避免图表空白
        if (!d?.latent?.available) {
          setSimulate(true)
          const d2 = await getTimelineEvent(eventId, { simulate_latent: true })
          setData(d2)
          return
        }
        setData(d)
      })
      .catch(console.error)
  }, [eventId])

  const loadWithSimulate = async () => {
    if (eventId == null) return
    setSimulate(true)
    const d = await getTimelineEvent(eventId, { simulate_latent: true })
    setData(d)
  }

  const points = data?.sensor?.points ?? 0

  // 有效通道（后端返回了非空序列的通道）
  const validChannels = useMemo(() => {
    if (!data) return []
    return Object.entries(data.sensor.series)
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .map(([k]) => k)
  }, [data])

  useEffect(() => {
    if (validChannels.length > 0 && !validChannels.includes(channel) && channel !== 'ALL') {
      setChannel('ALL')
    }
  }, [validChannels, channel])

  // 传感器曲线（采样点索引轴）
  const sensorOption = useMemo(() => {
    if (!data) return {}
    const list =
      channel === 'ALL'
        ? validChannels
        : validChannels.filter((c) => c === channel)
    const meta = CHANNEL_META[channel]
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) => (typeof v === 'number' ? v.toFixed(3) : String(v)),
      },
      legend: list.length > 1 ? { top: 0, type: 'scroll' } : undefined,
      grid: { left: 62, right: 24, top: list.length > 1 ? 36 : 24, bottom: 62 },
      xAxis: axisCommon(`采样点（共 ${points} 点，第 N 个采样点）`, points),
      yAxis: {
        type: 'value',
        name: channel === 'ALL' ? '读数（各通道原始量纲）' : `${meta?.name ?? channel}（${meta?.unit ?? ''}）`,
        nameTextStyle: { color: '#8fa3bd', fontSize: 12 },
        axisLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.45)' } },
        axisLabel: { show: true, color: '#8fa3bd', fontSize: 11 },
        splitLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.12)' } },
        scale: channel !== 'ALL',
      },
      series: list.map((name) => ({
        name: CHANNEL_META[name]?.name ?? name,
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { color: CHANNEL_META[name]?.color ?? '#38bdf8', width: channel === 'ALL' ? 1.6 : 2.2 },
        areaStyle:
          channel === 'ALL'
            ? undefined
            : { color: 'rgba(34, 211, 238, 0.14)' },
        data: (data.sensor.series[name] ?? []).map((v, i) => [i, v]),
      })),
    }
  }, [data, channel, points, validChannels])

  // 隐状态曲线
  const latentOption = useMemo(() => {
    if (!data) return {}
    const list = LATENT_CHANNELS.filter((c) => (data.latent.series[c.key] ?? []).length > 0)
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => (typeof v === 'number' ? v.toFixed(3) : String(v)) },
      legend: { top: 0 },
      grid: { left: 62, right: 24, top: 40, bottom: 62 },
      xAxis: axisCommon(`采样点（共 ${points} 点）`, points),
      yAxis: {
        type: 'value',
        name: '隐状态（0–1 归一化）',
        min: 0,
        max: 1,
        nameTextStyle: { color: '#8fa3bd', fontSize: 12 },
        axisLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.45)' } },
        axisLabel: { show: true, color: '#8fa3bd', fontSize: 11 },
        splitLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.12)' } },
      },
      series: list.map((c) => ({
        name: c.name,
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { color: c.color, width: 2 },
        data: (data.latent.series[c.key] as number[]).map((v, i) => [i, v]),
      })),
    }
  }, [data, points])

  const latentMissing = data && !data.latent.available && !data.latent.simulated

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <span>选择事件：</span>
          <Select
            style={{ width: 320 }}
            value={eventId}
            onChange={(v) => setEventId(v)}
            options={events.map((e) => ({
              value: e.id,
              label: `#${e.id} · ${e.device_id} · ${e.fault_type ?? '—'}`,
            }))}
          />
          {latentMissing && (
            <Button onClick={loadWithSimulate} loading={simulate && !data?.latent.simulated}>
              生成演示曲线
            </Button>
          )}
        </Space>
      </Card>

      {!data ? (
        <Card>
          <Empty description="暂无事件数据" />
        </Card>
      ) : (
        <>
          <Card
            title="传感器曲线"
            style={{ marginBottom: 16 }}
            extra={
              <ChartNote
                desc="事件触发时刻前后采集的多通道传感器原始读数随采样点变化的折线图。可选择单个通道查看（纵轴带单位），也可叠加全部通道对比各物理量的同步变化趋势。"
                dataSource="当前诊断事件保存的原始传感器窗口 Event.sensor_data（虚拟设备经 MQTT 上报的实时仿真数据；事件由 AI 会诊触发）。"
                insight="看趋势与突变：某通道在若干采样点后出现阶跃/持续抬升，即对应故障征兆；多通道同步抬升说明是整机工况变化，单通道异常则更可能是该测点或部件问题。"
              />
            }
          >
            <div style={{ marginBottom: 10 }}>
              <Space wrap>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>通道：</span>
                <Select
                  size="small"
                  style={{ width: 180 }}
                  value={channel}
                  onChange={setChannel}
                  options={[
                    { value: 'ALL', label: '全部通道（叠加对比）' },
                    ...validChannels.map((c) => ({
                      value: c,
                      label: `${CHANNEL_META[c]?.name ?? c}${CHANNEL_META[c]?.unit ? `（${CHANNEL_META[c].unit}）` : ''}`,
                    })),
                  ]}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  共 {points} 个采样点 · 有效通道 {validChannels.length} 个
                </span>
                {data.latent.simulated && <Tag color="purple">隐状态为演示曲线</Tag>}
              </Space>
            </div>
            <ReactECharts
              theme="tech-dark"
              option={sensorOption}
              style={{ height: 280 }}
              notMerge
            />
          </Card>

          <Card
            title="数字孪生隐状态"
            style={{ marginBottom: 16 }}
            extra={
              <ChartNote
                desc="数字孪生耦合随机微分方程（SDE）推演出的三个不可直接测量的内部退化状态：磨损、热积累、效率（均已归一化到 0–1）。三条曲线随采样点演化，反映设备内部的隐性退化进程。"
                dataSource={
                  data.latent.available
                    ? '虚拟设备 hidden_state 经 MQTT 上报的隐状态序列（仿真数据）。'
                    : '确定性演示曲线：由事件 ID + 故障类型 + 健康分按退化动力学生成（仿真数据，非实测）。'
                }
                insight="磨损/热积累持续上升而效率同步下降 = 真实退化；若隐状态恶化但传感器读数平稳，说明损伤尚在早期、未传导到可观测信号，正是预测性维护提前介入的窗口。"
              />
            }
          >
            {data.latent.available || data.latent.simulated ? (
              <ReactECharts theme="tech-dark" option={latentOption} style={{ height: 260 }} notMerge />
            ) : (
              <Empty description="无隐状态数据（演示模式）—— 点击上方「生成演示曲线」" />
            )}
          </Card>

          <Card
            title="事件标注时间线"
            extra={
              <ChartNote
                desc="按绝对时间轴排列的事件处置全过程审计链：事件触发 → 各状态变更（会诊/待确认/处置中/观察期/已恢复）→ 恢复或复发结论。每个节点记录时间、操作人与变更原因。"
                dataSource="EventTimeline 表（状态机每次推进写入的 who/when/why 审计记录）+ Event 触发时间 + feedback_result 反馈评估结论。"
                insight="用于追溯责任与复盘：谁在什么时候基于什么原因做了什么决策；「复发」节点提示上次处置未生效，需要重新诊断。"
              />
            }
          >
            <AntTimeline>
              {data.annotations.map((a, i) => (
                <AntTimeline.Item key={i} color={ANNOTATION_COLOR[a.type] ?? 'blue'}>
                  <Tooltip
                    title={
                      a.reason || a.operator
                        ? `${a.reason ?? ''}${a.operator ? `（操作人：${a.operator}）` : ''}`
                        : undefined
                    }
                  >
                    <Space wrap>
                      <Tag color={ANNOTATION_COLOR[a.type] ?? 'blue'}>{a.label}</Tag>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>
                        {a.time ? new Date(a.time).toLocaleString() : '—'}
                      </span>
                      {a.from && a.to && (
                        <span style={{ color: '#cbd5e1', fontSize: 12 }}>
                          {a.from} → {a.to}
                        </span>
                      )}
                      {a.operator && (
                        <span style={{ color: '#64748b', fontSize: 12 }}>操作人：{a.operator}</span>
                      )}
                    </Space>
                  </Tooltip>
                </AntTimeline.Item>
              ))}
            </AntTimeline>
          </Card>
        </>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Space, Spin, Statistic, Tag } from 'antd'
import ReactECharts from 'echarts-for-react'
import {
  getDeviceWindow,
  getDevices,
  getHealthHistory,
  getTimelineDevice,
  getTimelineEvent,
  type Device,
} from '../../services/api'
import ChartNote from '../../components/ChartNote'
import DigitalTwinPhm from '../../components/DigitalTwinPhm'
import SmartFactory from '../../components/SmartFactory'
import { xAxisBase, yAxisBase, AXIS_LABEL_COLOR } from '../../theme/echarts'

// ---------------------------------------------------------------------------
// 常量：状态 / 类型 的标签与颜色
// ---------------------------------------------------------------------------
const STATUS_HEX: Record<string, string> = {
  healthy: '#52c41a',
  degraded: '#fa8c16',
  fault: '#f5222d',
  offline: '#bfbfbf',
}

const STATUS_LABEL: Record<string, string> = {
  healthy: '正常',
  degraded: '退化',
  fault: '告警',
  offline: '离线',
}

const TYPE_LABEL: Record<string, string> = {
  pump: '泵',
  motor: '电机',
  compressor: '空压机',
}

// 隐状态三条曲线配置（磨损 / 热积累 / 效率）
const LATENT_CHANNELS: Array<{ key: string; name: string; color: string }> = [
  { key: 'latent_wear', name: '磨损', color: '#f5222d' },
  { key: 'latent_heat', name: '热积累', color: '#fa8c16' },
  { key: 'latent_efficiency', name: '效率', color: '#52c41a' },
]

// 实时传感器通道 -> 中文名 + 物理单位（用于图例，避免英文通道名晦涩）
const CHANNEL_LABEL: Record<string, string> = {
  vibration: '振动 (g)',
  temperature: '温度 (℃)',
  current: '电流 (A)',
  pressure: '压力 (bar)',
  speed: '转速 (rpm)',
  acoustic: '声压 (dB)',
}

// 面板卡片统一样式
const cardBodyStyle = { padding: 12 }

// ---------------------------------------------------------------------------
// 主组件：联动可视化大屏
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)

  // 选中设备的周边图数据
  const [windowData, setWindowData] = useState<Array<Record<string, number>>>([])
  const [latent, setLatent] = useState<Record<string, number[]>>()
  const [history, setHistory] = useState<Array<{ timestamp: string; health_score: number }>>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // 设备列表：5 秒轮询刷新（保持大屏数据新鲜）
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await getDevices()
        if (active) {
          setDevices(data)
          // 默认选中第一台设备，作为大屏初始联动锚点
          setSelectedId((prev) => prev ?? data[0]?.id)
        }
      } catch (e) {
        console.error('加载设备列表失败', e)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const selected = useMemo(
    () => devices.find((d) => d.id === selectedId),
    [devices, selectedId],
  )

  // 选中设备变化时，加载周边图数据（实时曲线 / 隐状态 / 健康历史）
  useEffect(() => {
    if (!selectedId) {
      setWindowData([])
      setLatent(undefined)
      setHistory([])
      return
    }
    let active = true
    setDetailLoading(true)

    const loadWindow = () =>
      getDeviceWindow(selectedId)
        .then((w) => {
          if (active && Array.isArray(w)) setWindowData(w)
        })
        .catch(() => {})

    const loadLatent = async () => {
      try {
        const d = await getTimelineDevice(selectedId)
        const first = d?.events?.[0]
        if (!first) return
        const td = await getTimelineEvent(first.event_id, { simulate_latent: true })
        if (active && td?.latent?.series) setLatent(td.latent.series)
      } catch {
        /* 无事件时不展示隐状态 */
      }
    }

    const loadHistory = () =>
      getHealthHistory(selectedId)
        .then((h) => {
          if (active) setHistory(h)
        })
        .catch(() => {})

    loadLatent()
    loadHistory()
    loadWindow().finally(() => setDetailLoading(false))
    const timer = setInterval(loadWindow, 3000) // 实时曲线 3 秒刷新

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [selectedId])

  // KPI 统计
  const normalCount = devices.filter((d) => d.health_score > 85).length
  const warningCount = devices.filter((d) => d.health_score >= 60 && d.health_score <= 85).length
  const alarmCount = devices.filter((d) => d.health_score < 60).length

  // 最需关注的设备（健康分最低）
  const riskiest = useMemo(
    () => (devices.length ? devices.reduce((a, b) => (b.health_score < a.health_score ? b : a)) : undefined),
    [devices],
  )

  // -------------------------------------------------------------------------
  // ① 主图：设备健康态势气泡散点
  //   X = 边缘异常分数(%)，Y = 健康评分，气泡颜色 = 状态，大小 = 异常严重度
  // -------------------------------------------------------------------------
  const scatterOption = useMemo(
    () => ({
      tooltip: {
        formatter: (p: any) => {
          const d = p.data
          const type = TYPE_LABEL[d.device_type] ?? d.device_type
          const status = STATUS_LABEL[d.status] ?? d.status
          return [
            `<b>${d.name}</b> <span style="color:#94a3b8">${d.deviceId}</span>`,
            `类型：${type}`,
            `状态：${status}`,
            `健康分：${d.value[1].toFixed(1)}`,
            `边缘异常：${d.value[0].toFixed(1)}%`,
          ].join('<br/>')
        },
      },
      grid: { left: 60, right: 30, top: 30, bottom: 55 },
      xAxis: xAxisBase({
        type: 'value',
        name: '边缘异常分数(%)',
        min: 0,
        max: 100,
        nameLocation: 'middle',
        nameGap: 30,
      }),
      yAxis: yAxisBase({ type: 'value', name: '健康评分(0–100)', min: 0, max: 100 }),
      series: [
        {
          type: 'scatter',
          symbolSize: (val: number[]) => 20 + Math.max(0, val[0]) * 0.35,
          itemStyle: {
            color: (p: any) => STATUS_HEX[p.data.status] ?? '#bfbfbf',
            shadowBlur: 6,
            shadowColor: 'rgba(0,0,0,0.2)',
          },
          data: devices.map((d) => ({
            value: [d.edge_anomaly_score * 100, d.health_score],
            deviceId: d.id,
            name: d.name,
            device_type: d.device_type,
            status: d.status,
          })),
        },
      ],
    }),
    [devices],
  )

  const onScatterClick = useCallback((params: any) => {
    const id = params?.data?.deviceId
    if (id) setSelectedId(id)
  }, [])

  // -------------------------------------------------------------------------
  // ② 实时传感器曲线（选中设备窗口内所有通道）
  // -------------------------------------------------------------------------
  const channels = windowData.length > 0 ? Object.keys(windowData[0]) : []
  const rtOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 55, right: 20, top: 36, bottom: 55 },
      xAxis: xAxisBase({ type: 'value', name: '采样点', nameLocation: 'middle', nameGap: 30 }),
      yAxis: yAxisBase({ type: 'value', name: '读数' }),
      series: channels.map((ch) => ({
        name: CHANNEL_LABEL[ch] ?? ch,
        type: 'line',
        showSymbol: false,
        smooth: true,
        data: windowData.map((rec, i) => [i, rec[ch]]),
      })),
    }),
    [windowData, channels],
  )

  // -------------------------------------------------------------------------
  // ③ 数字孪生隐状态退化轨迹
  // -------------------------------------------------------------------------
  const latentOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 55 },
      xAxis: xAxisBase({ type: 'value', name: '采样点', nameLocation: 'middle', nameGap: 30 }),
      yAxis: yAxisBase({ type: 'value', name: '归一化隐状态值' }),
      series: LATENT_CHANNELS.filter((c) => latent?.[c.key]?.length).map((c) => ({
        name: c.name,
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { color: c.color },
        data: (latent![c.key] as number[]).map((v, i) => [i, v]),
      })),
    }),
    [latent],
  )

  // -------------------------------------------------------------------------
  // ④ 健康历史趋势（含告警线）
  // -------------------------------------------------------------------------
  const historyOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 60, right: 20, top: 20, bottom: 60 },
      xAxis: xAxisBase({
        type: 'category',
        data: history.map((h) => h.timestamp?.slice(5, 16) ?? ''),
        axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11, rotate: history.length > 8 ? 35 : 0 },
      }),
      yAxis: yAxisBase({ type: 'value', name: '健康评分(0–100)', min: 0, max: 100 }),
      series: [
        {
          name: '健康分',
          type: 'line',
          showSymbol: true,
          smooth: true,
          data: history.map((h) => h.health_score),
          lineStyle: { color: '#38bdf8' },
          markLine: {
            data: [{ yAxis: 60, name: '告警线' }],
            lineStyle: { color: '#f5222d', type: 'dashed' },
          },
        },
      ],
    }),
    [history],
  )

  const healthColor = (s: number) => (s > 85 ? '#52c41a' : s >= 60 ? '#faad14' : '#f5222d')

  return (
    <Spin spinning={loading}>
      {/* 全局健康结论横幅：一句话读懂全厂态势 */}
      {!loading && (
        <div
          style={{
            marginBottom: 16,
            padding: '14px 18px',
            borderRadius: 10,
            background: 'rgba(34, 211, 238, 0.08)',
            border: '1px solid rgba(34, 211, 238, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: '#e6edf7' }}>
            {devices.length === 0
              ? '正在加载全厂设备…'
              : `全厂 ${devices.length} 台设备：正常 ${normalCount} · 预警 ${warningCount} · 告警 ${alarmCount}`}
          </span>
          {riskiest && (
            <span style={{ fontSize: 13, color: '#94a3b8' }}>
              当前最需关注：
              <span style={{ color: '#faad14', fontWeight: 600 }}>{riskiest.name}</span>
              （健康分 {Math.round(riskiest.health_score)}，{STATUS_LABEL[riskiest.status] ?? riskiest.status}）
            </span>
          )}
          <span style={{ fontSize: 13, color: '#94a3b8', marginLeft: 'auto' }}>
            点击下方气泡图任一点 → 联动切换该设备详情
          </span>
        </div>
      )}

      {/* 顶部 KPI 总览 */}
      <Row gutter={16} style={{ marginBottom: 16, alignItems: 'stretch' }}>
        <Col xs={12} sm={6}>
          <Card style={{ height: '100%' }}>
            <Statistic title="正常" value={normalCount} suffix="台" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card style={{ height: '100%' }}>
            <Statistic title="预警" value={warningCount} suffix="台" valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card style={{ height: '100%' }}>
            <Statistic title="告警" value={alarmCount} suffix="台" valueStyle={{ color: '#f5222d' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title="设备总数"
              value={devices.length}
              suffix="台"
              valueStyle={{ color: '#22d3ee' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 中间主图 + 左右联动图（重排：隐状态/散点各占半幅，传感器曲线全幅，横轴清晰可见） */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16, alignItems: 'stretch' }}>
        <Col xs={24} lg={8}>
          <Card
            title="数字孪生隐状态演化曲线"
            style={{ height: '100%' }}
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="数字孪生模型从可观测传感器信号中推断出的三种隐藏状态（磨损、热积累、效率）随采样的演化轨迹。"
                dataSource="虚拟设备仿真数据：由选中有诊断事件的设备，经数字孪生模型推断的隐状态序列（仿真数据）。"
                insight="磨损/热积累上升、效率下降，刻画设备从正常走向退化的内部机理。"
              />
            }
          >
            {latent ? (
              <ReactECharts theme="tech-dark" option={latentOption} style={{ height: 340 }} />
            ) : (
              <Empty description="选中有事件设备后展示" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card
            title="全厂设备健康态势散点图"
            style={{ height: '100%' }}
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="每台设备在「边缘异常分数 × 综合健康评分」二维空间中的位置分布：气泡颜色=健康状态，气泡大小=异常严重度。"
                dataSource="全厂设备实时台账（泵/电机/空压机等多类型，由虚拟设备仿真 + 边缘异常检测汇总）。"
                insight="越靠左上（健康分高、异常低）越健康；点击任一气泡可联动切换该设备的周边图。"
              />
            }
          >
            {devices.length > 0 ? (
              <ReactECharts theme="tech-dark"
                option={scatterOption}
                style={{ height: 340 }}
                onEvents={{ click: onScatterClick }}
              />
            ) : (
              <Empty description="暂无设备数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 实时传感器曲线：全幅展示，横轴不再被挤压 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={24}>
          <Card
            title="设备实时传感器曲线"
            styles={{ body: cardBodyStyle }}
            extra={
              <Space size={12}>
                <Tag color="orange">仿真数据</Tag>
                <ChartNote
                  desc="选中设备的多传感器通道实时采样曲线（振动/温度/电流/压力/转速/声压）。"
                  dataSource="虚拟设备仿真数据：由 MQTT 实时推送到大屏的仿真传感器读数（仿真数据）。"
                  insight="曲线突变或逼近阈值线是异常的早期征兆。"
                />
              </Space>
            }
          >
            {windowData.length > 0 ? (
              <ReactECharts theme="tech-dark" option={rtOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实时数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 底部：选中设备详情 + 健康历史（左窄右宽，等高对齐） */}
      <Row gutter={[16, 16]} style={{ alignItems: 'stretch' }}>
        <Col xs={24} lg={6}>
          <Card
            title="选中设备"
            style={{ height: '100%' }}
            styles={{ body: { ...cardBodyStyle, minHeight: 280 } }}
          >
            {selected ? (
              <div style={{ minHeight: 220, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>
                  {selected.name}{' '}
                  <Tag>{TYPE_LABEL[selected.device_type] ?? selected.device_type}</Tag>
                  <Tag color={STATUS_LABEL[selected.status] === '正常' ? 'green' : selected.status === '退化' ? 'orange' : selected.status === '告警' ? 'red' : 'default'}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </Tag>
                </div>
                <div style={{ fontSize: 40, fontWeight: 700, color: healthColor(selected.health_score), marginTop: 8 }}>
                  {Math.round(selected.health_score)}
                  <span style={{ fontSize: 14, color: '#94a3b8' }}>/100</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 13, color: '#78879b' }}>
                  <div>
                    边缘异常分数：{(selected.edge_anomaly_score * 100).toFixed(1)}%
                  </div>
                  <div>振动阈值：{selected.threshold_vibration ?? '—'}</div>
                  <div>温度阈值：{selected.threshold_temp ?? '—'}</div>
                </div>
              </div>
            ) : (
              <Empty description="暂无设备" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={18}>
          <Card
            title="设备健康评分变化趋势"
            style={{ height: '100%' }}
            styles={{ body: { ...cardBodyStyle, minHeight: 280 } }}
            extra={
              <ChartNote
                desc="选中设备的综合健康评分随时间的变化曲线，并用虚线标出 60 分告警阈值线。"
                dataSource="虚拟设备仿真运行过程中，该设备产生诊断事件后记录的历史健康评分序列（仿真数据）。"
                insight="健康分持续下探并跌破 60 分即进入告警，需人工介入。"
              />
            }
          >
            {history.length > 0 ? (
              <ReactECharts theme="tech-dark" option={historyOption} style={{ height: 260 }} />
            ) : (
              <Empty description="暂无健康历史（产生诊断事件后可见）" />
            )}
          </Card>
        </Col>
      </Row>

      {/* ============ 仿真数据可视化专区（仿真类可视化统一归入设备大屏） ============ */}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid #1e293b' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>
          仿真数据可视化
          <span style={{ fontSize: 12, fontWeight: 400, color: '#78879b', marginLeft: 8 }}>
            虚拟设备实时仿真 · 产线级仿真 · 数字孪生退化仿真（仿真数据，用于系统级验证，非真实工况）
          </span>
        </div>
      </div>

      {/* 产线级多机组异常态势（产线仿真数据） */}
      <div style={{ marginTop: 16, paddingTop: 8 }}>
        <SmartFactory />
      </div>

      {/* 数字孪生预测性维护（数字孪生仿真数据） */}
      <div style={{ marginTop: 32, paddingTop: 8 }}>
        <DigitalTwinPhm />
      </div>
    </Spin>
  )
}
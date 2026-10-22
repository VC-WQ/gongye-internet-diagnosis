import { LoadState } from './BusinessUI'
import { useResearchSource, useResearchChoice } from '../features/about/ResearchDataContext'
import { useMemo } from 'react'
import { Card, Col, Empty, Row, Select, Space, Spin, Table, Tag } from 'antd'
import ThemedChart from './ThemedChart'
import { getRulSdePf } from '../services/api'
import ChartNote from './ChartNote'
import { xAxisBase, yAxisBase } from '../theme/echarts'

const cardBodyStyle = { padding: 12 }

interface Metrics {
  mse: number
  rmse: number
  mae: number
  r2: number
  n_points: number
}

interface Curve {
  id: string
  condition: string
  actual: Array<number | null>
  sde_pf: Array<number | null>
  baseline: Array<number | null>
}

interface RulSdePfData {
  method: string
  baseline_method: string
  metrics: { sde_pf: Metrics; baseline: Metrics }
  curves: Curve[]
  config?: Record<string, unknown>
}

/**
 * 创新点二：数字孪生 SDE + 粒子滤波的剩余寿命（RUL）在线预测。
 *
 * 与旧实现的差别（也是这里要证明的）：
 *   · 旧：健康指标指数外推 —— 只能沿固定曲线外推，无法随新观测修正，R² 为负
 *   · 新：把磨损写成"自加速"随机微分方程状态方程，用粒子滤波在线估计退化速率
 *         并做首达时间（first-passage-time）外推，观测到来即修正后验
 *
 * 展示三块证据：① 精度指标对比 ② 单根轴承全寿命预测轨迹 ③ 15 根轴承误差分布
 */
export default function RulSdePf() {
  const { data, loading, error: loadError } = useResearchSource<RulSdePfData>('rul-sde-pf', getRulSdePf)
  const [curveId, setCurveId] = useResearchChoice('rul-curve')

  const curve = useMemo(
    () => data?.curves?.find((c) => c.id === (curveId ?? data?.curves?.[0]?.id)),
    [data, curveId],
  )

  // ① 精度指标对比（柱状图）
  const metricOption = useMemo(() => {
    const m = data?.metrics
    if (!m) return {}
    const names = ['RMSE ↓', 'MAE ↓', 'R² ↑']
    const base = [m.baseline.rmse, m.baseline.mae, m.baseline.r2]
    const sde = [m.sde_pf.rmse, m.sde_pf.mae, m.sde_pf.r2]
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 45 },
      xAxis: xAxisBase({ type: 'category', data: names }),
      yAxis: yAxisBase({ type: 'value', name: '指标值', nameLocation: 'middle', nameGap: 32 }),
      series: [
        {
          name: 'SDE + 粒子滤波（本文）',
          type: 'bar',
          data: sde,
          itemStyle: { color: '#477d9e' },
          label: { show: true, position: 'top', formatter: (p: { value: number }) => p.value.toFixed(3) },
        },
        {
          name: '健康指标指数外推（基线）',
          type: 'bar',
          data: base,
          itemStyle: { color: '#64748b' },
          label: { show: true, position: 'top', formatter: (p: { value: number }) => p.value.toFixed(3) },
        },
      ],
    }
  }, [data])

  // ② 单根轴承全寿命预测轨迹
  const curveOption = useMemo(() => {
    if (!curve) return {}
    const n = curve.actual.length
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 55 },
      xAxis: xAxisBase({ type: 'value', name: '全寿命进度 (%)', min: 0, max: 100, nameLocation: 'middle', nameGap: 30 }),
      yAxis: yAxisBase({ type: 'value', name: '剩余寿命 RUL (0–1)', nameLocation: 'middle', nameGap: 36, min: 0, max: 1 }),
      series: [
        {
          name: '真实 RUL',
          type: 'line',
          showSymbol: false,
          smooth: false,
          data: curve.actual.map((v, i) => [((i / (n - 1)) * 100).toFixed(1), v]),
          lineStyle: { color: '#bf5965', width: 2 },
          itemStyle: { color: '#bf5965' },
        },
        {
          name: 'SDE + 粒子滤波预测',
          type: 'line',
          showSymbol: false,
          smooth: false,
          connectNulls: false,
          data: curve.sde_pf.map((v, i) => [((i / (n - 1)) * 100).toFixed(1), v]),
          lineStyle: { color: '#477d9e', width: 2 },
          itemStyle: { color: '#477d9e' },
        },
        {
          name: '指数外推基线',
          type: 'line',
          showSymbol: false,
          smooth: false,
          connectNulls: false,
          data: curve.baseline.map((v, i) => [((i / (n - 1)) * 100).toFixed(1), v]),
          lineStyle: { color: '#6e7d8b', type: 'dashed' },
          itemStyle: { color: '#6e7d8b' },
        },
      ],
    }
  }, [curve])

  // ③ 15 根轴承各自的 MAE 对比
  const perBearingOption = useMemo(() => {
    const cs = data?.curves ?? []
    if (!cs.length) return {}
    const maeOf = (pred: Array<number | null>, actual: Array<number | null>) => {
      const pairs = pred
        .map((p, i) => [p, actual[i]] as const)
        .filter(([p, a]) => p != null && a != null) as Array<[number, number]>
      if (!pairs.length) return null
      return pairs.reduce((s, [p, a]) => s + Math.abs(p - a), 0) / pairs.length
    }
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 65 },
      xAxis: xAxisBase({
        type: 'category',
        data: cs.map((c) => c.id.replace('Bearing', 'B')),
        axisLabel: { rotate: 45 },
      }),
      yAxis: yAxisBase({ type: 'value', name: 'MAE ↓', nameLocation: 'middle', nameGap: 32 }),
      series: [
        {
          name: 'SDE + 粒子滤波',
          type: 'bar',
          data: cs.map((c) => { const value = maeOf(c.sde_pf, c.actual); return value == null ? null : +value.toFixed(4) }),
          itemStyle: { color: '#477d9e' },
        },
        {
          name: '指数外推基线',
          type: 'bar',
          data: cs.map((c) => { const value = maeOf(c.baseline, c.actual); return value == null ? null : +value.toFixed(4) }),
          itemStyle: { color: '#64748b' },
        },
      ],
    }
  }, [data])

  const m = data?.metrics
  const r2Gain = m ? m.sde_pf.r2 - m.baseline.r2 : 0
  const maeDrop = m && m.baseline.mae ? (m.baseline.mae - m.sde_pf.mae) / m.baseline.mae : 0

  return (
    <LoadState loading={loading} error={loadError} onRetry={() => window.location.reload()}><Spin spinning={false}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 12 }}>
          <Space size={8} wrap>
            <Tag color="cyan">SDE + PF</Tag>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              随机微分方程（SDE）建模磨损自加速过程 + 粒子滤波在线估计退化速率 + 首达时间外推 RUL
            </span>
          </Space>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title="RUL 预测精度对比"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="SDE + 粒子滤波 与 健康指标指数外推基线 在 XJTU-SY 15 根轴承全寿命数据上的 RMSE / MAE / R² 对比。"
                dataSource="XJTU-SY 西安交大轴承全寿命加速退化数据集（15 根轴承 · 真实公开数据），留一法评估。"
                insight={`R² 由 ${m ? m.baseline.r2.toFixed(3) : '--'} 提升到 ${m ? m.sde_pf.r2.toFixed(3) : '--'}（基线为负说明还不如用均值猜），MAE 下降 ${(maeDrop * 100).toFixed(0)}%。`}
              />
            }
          >
            {m ? (
              <ThemedChart option={metricOption} style={{ height: 280 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            title="单根轴承全寿命 RUL 预测轨迹"
            styles={{ body: cardBodyStyle }}
            extra={
              <Space size={12}>
                {data?.curves?.length ? (
                  <Select
                    size="small"
                    style={{ width: 170 }}
                    value={curve?.id}
                    onChange={setCurveId}
                    options={data.curves.map((c) => ({ value: c.id, label: `${c.id}（${c.condition}）` }))}
                  />
                ) : null}
                <ChartNote
                  desc="同一根轴承从投用到失效的全过程中，真实 RUL 与两种方法的预测 RUL 曲线。"
                  dataSource="XJTU-SY 全寿命振动数据（真实公开数据）；曲线前段为退化尚未启动的观测门控区，故预测线从寿命中后段开始。"
                  insight="青色曲线越贴合红色真实曲线越好；灰色虚线（指数外推）一旦偏离就无法自我修正，而粒子滤波会随每个新观测点修正后验。"
                />
              </Space>
            }
          >
            {curve ? (
              <ThemedChart option={curveOption} style={{ height: 280 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="15 根轴承逐一误差对比（MAE）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="按轴承分组统计的 RUL 预测平均绝对误差（MAE），逐根对比两种方法。"
                dataSource="XJTU-SY 15 根轴承 · 3 种工况（35Hz12kN / 37.5Hz11kN / 40Hz10kN），真实公开数据。"
                insight="逐轴承展示有效预测点上的 MAE；部分轴承并未优于基线。两种方法的有效预测区间可能不同，请结合具体曲线复核，缺失预测不记为零误差。"
              />
            }
          >
            {data?.curves?.length ? (
              <ThemedChart option={perBearingOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="指标明细" styles={{ body: cardBodyStyle }}>
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={
                m
                  ? [
                      {
                        name: 'SDE + 粒子滤波（本文）',
                        rmse: m.sde_pf.rmse.toFixed(4),
                        mae: m.sde_pf.mae.toFixed(4),
                        r2: m.sde_pf.r2.toFixed(4),
                        n: m.sde_pf.n_points,
                      },
                      {
                        name: '健康指标指数外推（基线）',
                        rmse: m.baseline.rmse.toFixed(4),
                        mae: m.baseline.mae.toFixed(4),
                        r2: m.baseline.r2.toFixed(4),
                        n: m.baseline.n_points,
                      },
                    ]
                  : []
              }
              columns={[
                { title: '方法', dataIndex: 'name', key: 'name' },
                { title: 'RMSE ↓', dataIndex: 'rmse', key: 'rmse' },
                { title: 'MAE ↓', dataIndex: 'mae', key: 'mae' },
                { title: 'R² ↑', dataIndex: 'r2', key: 'r2' },
                { title: '评估点数', dataIndex: 'n', key: 'n' },
              ]}
            />
            {m && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                SDE + PF 的 R² 为 {m.sde_pf.r2.toFixed(3)}，指数外推基线为 {m.baseline.r2.toFixed(3)}；
                差值 {r2Gain >= 0 ? '+' : ''}{r2Gain.toFixed(3)}。R² 为负表示在本次评估中不如预测均值。
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </Spin></LoadState>
  )
}

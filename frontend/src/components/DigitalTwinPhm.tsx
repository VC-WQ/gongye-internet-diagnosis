import { LoadState } from './BusinessUI'
import { useResearchSource } from '../features/about/ResearchDataContext'
import { useMemo } from 'react'
import { Card, Col, Empty, Row, Space, Spin, Statistic } from 'antd'
import ThemedChart from './ThemedChart'
import { getPumpPhm } from '../services/api'
import ChartNote from './ChartNote'
import { xAxisBase, yAxisBase } from '../theme/echarts'

// 卡片统一样式（与 DataAnalysis 保持一致）
const cardBodyStyle = { padding: 12 }

interface PumpPhm {
  overview: {
    n_trajectories: number
    n_steps: number
    failure_type_dist: Array<{ name: string; value: number }>
  }
  degradation: {
    id: string
    failure_type: string
    events: { crit_at: number | null; maint_at: number | null; fail_at: number | null }
    series: Array<{ t: number; hazard: number; prob: number; vib_n: number }>
  }
  ttf_prediction: {
    points: Array<[number, number]>
    metrics: { n: number; mae_hours: number; rmse_hours: number; corr: number }
  }
  maintenance_roi: {
    avg_maintenance_cost: number
    avg_expected_savings: number
    avg_downtime_loss: number
    avg_cumulative_loss: number
    roi: number
  }
}

const FAULT_TYPE_LABEL: Record<string, string> = {
  bearing_wear: '轴承磨损',
  cavitation: '气蚀',
  seal_failure: '密封失效',
  motor_burnout: '电机烧毁',
}

/**
 * 数字孪生预测性维护大屏区块（DigitalTwin 泵 全寿命数据实证）。
 *
 * 四块证据链，四种图表、四个角度（互不重复）：
 *   ① 退化轨迹（line + 事件 markLine）—— 数字孪生如何在运行中预判故障
 *   ② 故障类型分布（玫瑰图）            —— 数据覆盖面 / 故障谱系
 *   ③ 剩余寿命 TTF 预测精度（scatter）  —— 数字孪生的预测准确性
 *   ④ 维护价值闭环（横向 bar + ROI）    —— 预测性维护的经济价值
 * 结论落点：数字孪生 = 物理信号 + 数据驱动预测，提前干预换回可量化回报。
 */
export default function DigitalTwinPhm() {
  const { data, loading, error: loadError } = useResearchSource<PumpPhm>('digital-twin-phm', getPumpPhm)

  // -----------------------------------------------------------------------
  // ① 退化轨迹：hazard / 故障概率 / 振动（归一化）随运行小时演化
  //    垂直 markLine 标注三个关键事件时刻
  // -----------------------------------------------------------------------
  const degOption = useMemo(() => {
    const s = data?.degradation?.series ?? []
    if (!s.length) return {}
    const ev = data!.degradation.events
    const markLine = ([
      ev.crit_at != null && { xAxis: ev.crit_at, name: '进入临界', lineStyle: { color: '#9a6a25', type: 'dashed' } },
      ev.maint_at != null && { xAxis: ev.maint_at, name: '预防维护', lineStyle: { color: '#477d9e', type: 'dashed' } },
      ev.fail_at != null && { xAxis: ev.fail_at, name: '失效', lineStyle: { color: '#bf5965', type: 'solid' } },
    ] as Array<{ xAxis: number; name: string; lineStyle: { color: string; type: string } }>).filter(Boolean)

    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 30, top: 32, bottom: 50 },
      xAxis: xAxisBase({ type: 'value', name: '运行时间(小时)' }),
      yAxis: yAxisBase({ type: 'value', name: '归一化指标值(0–1)', min: 0, max: 1 }),
      series: [
        {
          name: '健康风险 hazard',
          type: 'line',
          showSymbol: false,
          smooth: false,
          data: s.map((p) => [p.t, p.hazard]),
          lineStyle: { color: '#bf5965', width: 2 },
          itemStyle: { color: '#bf5965' },
          markLine: { silent: true, symbol: 'none', data: markLine },
        },
        {
          name: '故障概率(7天)',
          type: 'line',
          showSymbol: false,
          smooth: false,
          data: s.map((p) => [p.t, p.prob]),
          lineStyle: { color: '#9a6a25' },
          itemStyle: { color: '#9a6a25' },
        },
        {
          name: '振动(归一化)',
          type: 'line',
          showSymbol: false,
          smooth: false,
          data: s.map((p) => [p.t, p.vib_n]),
          lineStyle: { color: '#348875', type: 'dotted' },
          itemStyle: { color: '#348875' },
        },
      ],
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ② 故障类型分布（玫瑰图）
  // -----------------------------------------------------------------------
  const distOption = useMemo(() => {
    const dist = data?.overview?.failure_type_dist ?? []
    if (!dist.length) return {}
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} 台 ({d}%)' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['25%', '65%'],
          center: ['50%', '45%'],
          roseType: 'radius',
          itemStyle: { borderRadius: 0 },
          label: { formatter: '{b}\n{c}' },
          data: dist.map((d) => ({
            name: FAULT_TYPE_LABEL[d.name] ?? d.name,
            value: d.value,
          })),
        },
      ],
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ③ TTF 剩余寿命预测精度（预测 vs 真实 散点 + y=x 理想线）
  // -----------------------------------------------------------------------
  const ttfOption = useMemo(() => {
    const pts = data?.ttf_prediction?.points ?? []
    if (!pts.length) return {}
    const maxV = Math.max(...pts.map((p) => Math.max(p[0], p[1])))
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 55, right: 25, top: 20, bottom: 50 },
      xAxis: xAxisBase({ type: 'value', name: '真实 TTF(小时)', min: 0, max: maxV }),
      yAxis: yAxisBase({ type: 'value', name: '预测 TTF(小时)', min: 0, max: maxV }),
      series: [
        {
          name: '预测 vs 真实',
          type: 'scatter',
          symbolSize: 4,
          data: pts.map((p) => [p[0], p[1]]),
          itemStyle: { color: '#477d9e', opacity: 0.6 },
        },
        {
          name: '理想线 y=x',
          type: 'line',
          showSymbol: false,
          data: [
            [0, 0],
            [maxV, maxV],
          ],
          lineStyle: { color: '#6e7d8b', type: 'dashed' },
          itemStyle: { color: '#6e7d8b' },
        },
      ],
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ④ 维护价值闭环（横向 bar：成本 vs 节省 vs 损失对比）
  // -----------------------------------------------------------------------
  const roiOption = useMemo(() => {
    const r = data?.maintenance_roi
    if (!r) return {}
    const items = [
      { name: '平均预防维护成本', value: r.avg_maintenance_cost, color: '#477d9e' },
      { name: '平均预期节省', value: r.avg_expected_savings, color: '#348875' },
      { name: '平均停机损失', value: r.avg_downtime_loss, color: '#9a6a25' },
      { name: '平均累计损失(不干预)', value: r.avg_cumulative_loss, color: '#bf5965' },
    ]
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `$${v.toLocaleString()}` },
      grid: { left: 150, right: 40, top: 20, bottom: 30 },
      xAxis: xAxisBase({ type: 'value', name: '美元($)' }),
      yAxis: yAxisBase({ type: 'category', data: items.map((i) => i.name) }),
      series: [
        {
          type: 'bar',
          data: items.map((i) => i.value),
          itemStyle: {
            color: (p: any) => items[p.dataIndex].color,
          },
          label: { show: false },
        },
      ],
    }
  }, [data])

  const roi = data?.maintenance_roi?.roi
  const mae = data?.ttf_prediction?.metrics?.mae_hours

  return (
    <LoadState loading={loading} error={loadError} onRetry={() => window.location.reload()}><Spin spinning={false}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={24} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--status-info)" }}>
            数字孪生预测性维护（DigitalTwin 仿真数据集实证）
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {data ? `${data.overview.n_trajectories} 条运行轨迹 / ${data.overview.n_steps.toLocaleString()} 时间步 · 数字孪生预测 TTF 平均误差仅 ${mae}h，预防维护 ROI ${roi}x` : ''}
          </div>
        </Col>

        <Col xs={24} lg={13}>
          <Card
            title={`退化轨迹（${FAULT_TYPE_LABEL[data?.degradation?.failure_type ?? ''] ?? data?.degradation?.failure_type ?? '—'}）`}
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="数字孪生泵的健康风险 hazard / 故障概率 / 振动随运行小时演化，虚线标注进入临界、预防维护、失效三个关键事件时刻。"
                dataSource="DigitalTwin 泵数字孪生仿真数据集（150 条退化轨迹，物理信号 + 数据驱动预测，仿真数据）。"
                insight="hazard 曲线爬升即提前预警，可在失效前介入维护，实现预测性维护。"
              />
            }
          >
            {data ? (
              <ThemedChart option={degOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={11}>
          <Card
            title="故障类型分布"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="泵的四大故障模式（轴承磨损/气蚀/密封失效/电机烧毁）数量占比。"
                dataSource="DigitalTwin 泵数字孪生仿真数据集（故障谱系统计，仿真数据）。"
                insight="覆盖多种故障谱系，说明数字孪生退化建模的多样性。"
              />
            }
          >
            {data ? (
              <ThemedChart option={distOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12} style={{ marginTop: 16 }}>
          <Card
            title="故障时间 TTF 预测精度（数字孪生·泵）"
            styles={{ body: cardBodyStyle }}
            extra={
              data ? (
                <Space size={16}>
                  <Statistic
                    title="平均绝对误差"
                    value={mae}
                    suffix="小时"
                    valueStyle={{ fontSize: 18, color: "var(--status-ok)" }}
                  />
                  <ChartNote
                    desc="预测剩余寿命 TTF 与真实值的散点对比，越贴近 y=x 理想线预测越准。"
                    dataSource="DigitalTwin 泵数字孪生仿真数据集（TTF 预测 vs 真实值，仿真数据）。"
                    insight="点云贴合对角线 = 数字孪生预测准确，平均绝对误差见左上角。"
                  />
                </Space>
              ) : (
                <ChartNote
                  desc="预测剩余寿命 TTF 与真实值的散点对比，越贴近 y=x 理想线预测越准。"
                  dataSource="DigitalTwin 泵数字孪生仿真数据集（TTF 预测 vs 真实值，仿真数据）。"
                  insight="点云贴合对角线 = 数字孪生预测准确。"
                />
              )
            }
          >
            {data ? (
              <ThemedChart option={ttfOption} style={{ height: 260 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12} style={{ marginTop: 16 }}>
          <Card
            title="预测性维护价值闭环"
            styles={{ body: cardBodyStyle }}
            extra={
              data ? (
                <Space size={16}>
                  <Statistic
                    title="ROI"
                    value={roi}
                    suffix="x"
                    valueStyle={{ fontSize: 18, color: "var(--status-info)" }}
                  />
                  <ChartNote
                    desc="预防维护成本、预期节省、停机损失、不干预累计损失四项对比，量化预测性维护的经济价值。"
                    dataSource="DigitalTwin 泵数字孪生仿真数据集（含维护价值字段的经济模型，仿真数据）。"
                    insight="预期节省 > 维护成本即 ROI 为正，说明预测性维护能换回可量化回报。"
                  />
                </Space>
              ) : (
                <ChartNote
                  desc="预防维护成本、预期节省、停机损失、不干预累计损失四项对比。"
                  dataSource="DigitalTwin 泵数字孪生仿真数据集（含维护价值字段，仿真数据）。"
                  insight="预期节省 > 维护成本即 ROI 为正。"
                />
              )
            }
          >
            {data ? (
              <ThemedChart option={roiOption} style={{ height: 260 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>
      </Row>
    </Spin></LoadState>
  )
}

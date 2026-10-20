import { LoadState } from './BusinessUI'
import { errorText } from '../hooks/useResource'
import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Spin, Statistic } from 'antd'
import ThemedChart from './ThemedChart'
import { getSmartFactory } from '../services/api'
import ChartNote from './ChartNote'
import { xAxisBase, yAxisBase } from '../theme/echarts'

const cardBodyStyle = { padding: 12 }

interface SmartFactoryData {
  overview: {
    n_samples: number
    n_machines: number
    n_sections: number
    failure_rate: number
    maintenance_rate: number
  }
  section_health: {
    items: Array<{ name: string; label: string; failures: number; total: number; failure_rate: number }>
  }
  sensor_anomaly: {
    items: Array<{ name: string; label: string; normal: number; fault: number; delta_pct: number }>
  }
  machine_health: { bins: number[]; counts: number[]; mean_rate: number; max_rate: number }
}

/**
 * SmartFactory 产线级多机组异常态势（系统层方法论实证）。
 *
 * 三块证据链，三种图表、三个角度（与单设备/单轴承/单泵的分析不重复）：
 *   ① 工段故障率（玫瑰图）        —— 产线级「哪里最危险」
 *   ② 传感器异常度（左右分组条形）—— 故障征兆的「多传感器证据」
 *   ③ 设备健康分布（直方图）      —— 500 台机组的「风险分布」
 * 结论落点：从单机诊断上升到产线级态势感知，体现系统治理视角。
 */
export default function SmartFactory() {
  const [data, setData] = useState<SmartFactoryData>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    getSmartFactory()
      .then((d) => {
        if (active) setData(d)
      })
      .catch((e) => { if (active) setLoadError(errorText(e)) })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // -----------------------------------------------------------------------
  // ① 工段故障率玫瑰图
  // -----------------------------------------------------------------------
  const sectionOption = useMemo(() => {
    const items = data?.section_health?.items ?? []
    if (!items.length) return {}
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c}({d}%)' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['20%', '70%'],
          center: ['50%', '45%'],
          roseType: 'radius',
          itemStyle: { borderRadius: 0 },
          label: { formatter: '{b}\n{c}' },
          data: items.map((d) => ({ name: d.label, value: d.failures })),
        },
      ],
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ② 传感器异常度（左右分组条形：正常 vs 故障均值）
  // -----------------------------------------------------------------------
  const sensorOption = useMemo(() => {
    const items = data?.sensor_anomaly?.items ?? []
    if (!items.length) return {}
    const labels = items.map((d) => d.label)
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 32, bottom: 45 },
      xAxis: xAxisBase({ type: 'category', data: labels }),
      yAxis: yAxisBase({ type: 'value', name: '归一化传感器读数', scale: true }),
      series: [
        {
          name: '正常运行',
          type: 'bar',
          data: items.map((d) => d.normal),
          itemStyle: { color: '#477d9e' },
        },
        {
          name: '故障状态',
          type: 'bar',
          data: items.map((d) => d.fault),
          itemStyle: { color: '#bf5965' },
          label: {
            show: true,
            position: 'top',
            formatter: (p: any) => `${items[p.dataIndex].delta_pct > 0 ? '+' : ''}${items[p.dataIndex].delta_pct}%`,
            fontSize: 10,
            color: '#bf5965',
          },
        },
      ],
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ③ 设备故障率分布直方图
  // -----------------------------------------------------------------------
  const histOption = useMemo(() => {
    const h = data?.machine_health
    if (!h?.bins?.length) return {}
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any) => {
          const p = ps[0]
          const lo = h.bins[p.dataIndex]
          const hi = h.bins[p.dataIndex + 1]
          return `故障率 ${(lo * 100).toFixed(0)}%~${((hi ?? 0.3) * 100).toFixed(0)}%<br/>设备数: ${p.value} 台`
        },
      },
      grid: { left: 55, right: 25, top: 20, bottom: 50 },
      xAxis: xAxisBase({
        type: 'category',
        name: '单机故障率',
        data: h.bins.slice(0, -1).map((b) => `${(b * 100).toFixed(0)}%`),
        axisLabel: { fontSize: 11, rotate: h.bins.length > 8 ? 30 : 0 },
      }),
      yAxis: yAxisBase({ type: 'value', name: '设备数(台)' }),
      series: [
        {
          type: 'bar',
          data: h.counts,
          itemStyle: { color: '#477d9e' },
          label: { show: true, position: 'top', fontSize: 10 },
        },
      ],
    }
  }, [data])

  const ov = data?.overview

  return (
    <LoadState loading={loading} error={loadError} onRetry={() => window.location.reload()}><Spin spinning={false}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={24} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--status-info)" }}>
            产线级多机组异常态势（SmartFactory 合成数据集实证）
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {ov
              ? `${ov.n_samples.toLocaleString()} 条运行记录 · ${ov.n_machines} 台设备 / ${ov.n_sections} 个工段 · 整体故障率 ${(ov.failure_rate * 100).toFixed(1)}%`
              : ''}
          </div>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title="① 工段故障分布（玫瑰图）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="各生产工段的故障次数占比（玫瑰图扇区越大 = 该工段故障越集中）。"
                dataSource="SmartFactory 产线级仿真数据集（8 工段 × 500 台机组故障统计，产线仿真数据）。"
                insight="定位产线上「哪里最危险」，回答从单机诊断上升到产线态势的治理视角。"
              />
            }
          >
            {data ? (
              <ThemedChart option={sectionOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title="② 故障征兆·多传感器异常度"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="各传感器在「正常运行 vs 故障状态」下的归一化读数对比，柱顶标注故障态相对正常态的偏离百分比。"
                dataSource="SmartFactory 产线级仿真数据集（6 类传感器正常/故障读数统计，产线仿真数据）。"
                insight="偏离越大（红色 +% 越高）的传感器越能提前预示故障，体现多传感器证据链。"
              />
            }
          >
            {data ? (
              <ThemedChart option={sensorOption} style={{ height: 220 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title="③ 设备故障率分布"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="500 台机组单机故障率的分布直方图（横轴故障率区间，纵轴设备台数）。"
                dataSource="SmartFactory 产线级仿真数据集（500 台机组故障率统计，产线仿真数据）。"
                insight="大部分机组故障率低，少数高风险机组构成长尾，即重点盯防对象。"
              />
            }
          >
            {data ? (
              <ThemedChart option={histOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>
      </Row>
    </Spin></LoadState>
  )
}

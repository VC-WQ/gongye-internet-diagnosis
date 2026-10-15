import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Spin, Tag } from 'antd'
import ReactECharts from 'echarts-for-react'
import { getDatasetRegistry } from '../services/api'
import ChartNote from './ChartNote'

const cardBodyStyle = { padding: 12 }

interface DatasetMeta {
  name: string
  label: string
  task: string
  task_label: string
  modality: string
  samples: number
  dim: string
  classes: number
  class_names: string[]
  source: string
  size_gb: number
  used_in: string
}

interface RegistryData {
  summary: {
    n_datasets: number
    total_samples: number
    total_size_gb: number
    task_dist: Array<{ task: string; task_label: string; count: number }>
  }
  datasets: DatasetMeta[]
}

// 任务类型配色
const TASK_COLOR: Record<string, string> = {
  signal_cls: '#38bdf8',
  rul: '#52c41a',
  detection: '#722ed1',
  anomaly: '#fa8c16',
  tab_cls: '#13c2c2',
  regression: '#eb2f96',
}

function fmt(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + ' 亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万'
  return n.toLocaleString()
}

/**
 * 数据资产总览（A）—— 展示 8 个数据集（6 真实公开 + 2 仿真）的覆盖度与规模。
 *
 *   - 顶部 3 个 KPI：数据集数 / 样本总量 / 总占用
 *   - 任务类型占比（环形图）
 *   - 8 数据集目录卡片（名称/规模/维度/类别/任务/来源）
 */
export default function DataAssetRegistry() {
  const [data, setData] = useState<RegistryData>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getDatasetRegistry()
      .then((d) => {
        if (active) setData(d)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const taskOption = useMemo(() => {
    const dist = data?.summary?.task_dist ?? []
    if (!dist.length) return {}
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} 个 ({d}%)' },
      legend: { orient: 'vertical', left: 10, top: 'center', itemWidth: 12, itemHeight: 12 },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['60%', '50%'],
          itemStyle: { borderRadius: 4 },
          label: { show: false },
          data: dist.map((d) => ({
            name: d.task_label,
            value: d.count,
            itemStyle: { color: TASK_COLOR[d.task] ?? '#94a3b8' },
          })),
        },
      ],
    }
  }, [data])

  const s = data?.summary

  return (
    <Spin spinning={loading}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#22d3ee' }}>
            数据资产总览（8 个数据集：6 个真实公开 + 2 个仿真 · 覆盖五大诊断任务）
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            信号分类 / 剩余寿命预测 / 缺陷检测 / 产线异常 / 表格分类回归 —— 本页为离线静态预计算实证结果（非实时仿真）；
            其中 DigitalTwin 泵、SmartFactory 产线两个数据集为仿真生成，其仿真可视化已归入「设备大屏」页面
          </div>
        </Col>

        {/* 顶部 KPI */}
        <Col span={24} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            {[
              { label: '公开数据集', value: s?.n_datasets ?? 0, suffix: '个', color: '#22d3ee' },
              { label: '样本总量', value: s ? fmt(s.total_samples) : 0, suffix: '', color: '#52c41a' },
              { label: '数据总占用', value: s?.total_size_gb ?? 0, suffix: 'GB', color: '#fa8c16' },
            ].map((k) => (
              <Col xs={8} key={k.label}>
                <Card styles={{ body: { padding: 16, textAlign: 'center' } }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: k.color }}>
                    {k.value}
                    <span style={{ fontSize: 14, fontWeight: 400, color: '#94a3b8' }}>{k.suffix}</span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>{k.label}</div>
                </Card>
              </Col>
            ))}
          </Row>
        </Col>

        {/* 任务类型占比 */}
        <Col xs={24} lg={8}>
          <Card
            title="诊断任务覆盖分布"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="8 个数据集按五大诊断任务（信号分类/剩余寿命/缺陷检测/产线异常/表格分类回归）的数量占比环形图。"
                dataSource="8 个数据集目录汇总（CWRU / XJTU-SY / NEU-DET / Steam / MachineFault / ManufacturingDefect 为真实公开数据，DigitalTwin / SmartFactory 为仿真数据；共约 51 万样本 · 16.3GB）。"
                insight="任务类型覆盖越全，说明整套诊断系统的数据底座越完整、方法越通用。"
              />
            }
          >
            {data ? (
              <ReactECharts theme="tech-dark" option={taskOption} style={{ height: 360 }} />
            ) : (
              <Empty description="数据准备中" />
            )}
          </Card>
        </Col>

        {/* 数据集目录卡片 */}
        <Col xs={24} lg={16}>
          <Row gutter={[12, 12]}>
            {data?.datasets?.map((d) => (
              <Col xs={24} sm={12} key={d.name}>
                <Card
                  size="small"
                  title={
                    <span style={{ fontSize: 13 }}>
                      {d.label}
                    </span>
                  }
                  extra={<Tag color={TASK_COLOR[d.task] ?? 'blue'}>{d.task_label}</Tag>}
                  styles={{ body: { padding: 12 } }}
                >
                  <div style={{ fontSize: 12, color: '#78879b', lineHeight: 1.9 }}>
                    <div>
                      <b>样本量：</b>
                      {fmt(d.samples)}
                      {d.size_gb > 0 ? ` · ${d.size_gb} GB` : ''}
                    </div>
                    <div>
                      <b>维度：</b>
                      {d.dim}
                    </div>
                    <div>
                      <b>类别：</b>
                      {d.classes} 类（{d.class_names.join(' / ')}）
                    </div>
                    <div>
                      <b>来源：</b>
                      {d.source}
                    </div>
                    <div style={{ color: '#94a3b8' }}>
                      <b>用于：</b>
                      {d.used_in}
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </Col>
      </Row>
    </Spin>
  )
}
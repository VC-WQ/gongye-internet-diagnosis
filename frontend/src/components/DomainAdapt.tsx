import { LoadState } from './BusinessUI'
import { errorText } from '../hooks/useResource'
import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Space, Spin, Table, Tag } from 'antd'
import ReactECharts from 'echarts-for-react'
import { getDomainAdapt } from '../services/api'
import ChartNote from './ChartNote'
import { xAxisBase, yAxisBase } from '../theme/echarts'

const cardBodyStyle = { padding: 12 }

interface VariantResult {
  id: string
  title: string
  model: string
  method: string
  source_test_accuracy: number | null
  target_macro_accuracy: number
  gain_vs_v0: number
  per_device: Record<string, { name: string; accuracy: number; per_class: Record<string, number> }>
}

interface TargetDomain {
  name: string
  shaft_rpm: number
  fs: number
  resonance_hz: number
  snr_db: number
  bearing: { n_balls: number; ball_diam_mm: number; pitch_diam_mm: number }
  freqs: Record<string, number>
  n_train_unlabeled: number
  n_test: number
}

interface DomainAdaptData {
  experiment: string
  problem: string
  source_domain: { name: string; profile: Record<string, number>; freqs: Record<string, number>; n_train: number; n_test: number }
  target_domains: Record<string, TargetDomain>
  class_labels: Record<string, string>
  methods: Record<string, string>
  results: VariantResult[]
  conclusion: string
}

const VARIANT_COLOR: Record<string, string> = {
  V0: '#64748b',
  V1: '#477d9e',
  V2: '#76689a',
  V3: '#477d9e',
  V4: '#bf5965',
}

/**
 * 创新点四：跨域自适应（CWRU 实验室试验台 -> 三类仿真设备）。
 *
 * 要证明的是"实验室训练的模型能不能直接用到现场设备"：
 *   ① 先量化域漂移有多大（V0 源域直接迁移掉多少）
 *   ② 再用两种无监督域自适应（CORAL / DANN）把它补回来
 *   ③ 给出目标域带标签训练的上界作为参照，说明还剩多少空间
 * 全程不需要目标域标签 —— 这是工程落地的关键前提。
 */
export default function DomainAdapt() {
  const [data, setData] = useState<DomainAdaptData>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    getDomainAdapt()
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

  const devIds = useMemo(() => Object.keys(data?.target_domains ?? {}), [data])
  const results = data?.results ?? []

  // ① 每台设备上各变体的准确率（分组柱状图）
  const perDeviceOption = useMemo(() => {
    if (!devIds.length || !results.length) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 55, right: 20, top: 60, bottom: 55 },
      xAxis: xAxisBase({
        type: 'category',
        data: devIds.map((d) => data!.target_domains[d].name),
        name: '目标域设备',
        nameLocation: 'middle',
        nameGap: 32,
      }),
      yAxis: yAxisBase({ type: 'value', name: '目标域准确率', min: 0, max: 1, nameLocation: 'middle', nameGap: 34 }),
      series: results.map((r) => ({
        name: r.title,
        type: 'bar',
        data: devIds.map((d) => r.per_device[d]?.accuracy ?? 0),
        itemStyle: { color: VARIANT_COLOR[r.id] ?? '#6e7d8b' },
      })),
    }
  }, [data, devIds, results])

  // ② 变体汇总折线（源域准确率 vs 目标域宏平均）
  const summaryOption = useMemo(() => {
    if (!results.length) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 55 },
      xAxis: xAxisBase({ type: 'category', data: results.map((r) => r.id) }),
      yAxis: yAxisBase({ type: 'value', name: '准确率', min: 0, max: 1, nameLocation: 'middle', nameGap: 34 }),
      series: [
        {
          name: '源域 CWRU 测试准确率',
          type: 'line',
          symbolSize: 8,
          connectNulls: true,
          data: results.map((r) => r.source_test_accuracy),
          lineStyle: { color: '#bf5965' },
          itemStyle: { color: '#bf5965' },
        },
        {
          name: '目标域宏平均准确率',
          type: 'line',
          symbolSize: 8,
          data: results.map((r) => r.target_macro_accuracy),
          lineStyle: { color: '#477d9e' },
          itemStyle: { color: '#477d9e' },
        },
      ],
    }
  }, [results])

  const v0 = results.find((r) => r.id === 'V0')
  const best = useMemo(() => {
    const cands = results.filter((r) => r.id !== 'V0' && r.id !== 'V4')
    return cands.length ? cands.reduce((a, b) => (b.target_macro_accuracy > a.target_macro_accuracy ? b : a)) : undefined
  }, [results])
  const v4 = results.find((r) => r.id === 'V4')

  return (
    <LoadState loading={loading} error={loadError} onRetry={() => window.location.reload()}><Spin spinning={false}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 12 }}>
          <Space size={8} wrap>
            <Tag color="cyan">CORAL / DANN</Tag>
            <span style={{ color: '#6e7d8b', fontSize: 13 }}>
              CWRU 试验台训练 → 迁移到离心泵 / 电机 / 空压机三类设备，
              用 CORAL / DANN 做<strong style={{ color: '#293543' }}>无目标域标签</strong>的域自适应
            </span>
          </Space>
        </Col>

        <Col span={24} style={{ marginBottom: 16 }}>
          <Card styles={{ body: cardBodyStyle }}>
            <div style={{ fontSize: 13, color: '#536170', marginBottom: 8 }}>
              <strong style={{ color: '#477d9e' }}>要解决的问题：</strong>
              {data?.problem ?? '加载中…'}
            </div>
            <div style={{ fontSize: 12, color: '#6e7d8b' }}>
              智能会诊的故障分类依赖 CWRU 数据集训练的 1D-CNN，但它采集自实验室电机试验台；
              现场三类设备的轴承型号、转速、采样率、结构共振与信噪比全都不同，
              直接迁移会产生分布漂移。本实验量化该漂移，并验证无监督域自适应能否补回。
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            title="三种设备上各方法的目标准确率"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="在三类仿真设备各自的测试集上，五个变体的诊断准确率对比。"
                dataSource="源域：CWRU 轴承数据集（真实公开）；目标域：按各设备轴承几何/转速/采样率/共振/信噪比物理机理生成的仿真振动信号。"
                insight={
                  v0 && best
                    ? `直接迁移仅 ${(v0.target_macro_accuracy * 100).toFixed(1)}%，域漂严重；${best.title} 提升到 ${(best.target_macro_accuracy * 100).toFixed(1)}%。`
                    : '灰色柱（直接迁移）越低说明域漂移越大；彩色柱越高说明自适应补回越多。'
                }
              />
            }
          >
            {devIds.length && results.length ? (
              <ReactECharts theme="tech-dark" option={perDeviceOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title="源域 vs 目标域准确率走势"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="每个变体在源域（CWRU 测试集）与目标域（三类设备宏平均）上的准确率对比。"
                dataSource="CWRU 真实公开数据 + 按物理机理生成的三类设备仿真振动数据。"
                insight="红线（源域）几乎不动而青线（目标域）大幅上升，说明自适应提升的是跨域泛化能力，而非牺牲源域性能换来的。"
              />
            }
          >
            {results.length ? (
              <ReactECharts theme="tech-dark" option={summaryOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="实验结果汇总" styles={{ body: cardBodyStyle }}>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={results.map((r) => ({
                id: r.id,
                title: r.title,
                src: r.source_test_accuracy == null ? '—' : (r.source_test_accuracy * 100).toFixed(1) + '%',
                tgt: (r.target_macro_accuracy * 100).toFixed(1) + '%',
                gain: (r.gain_vs_v0 >= 0 ? '+' : '') + (r.gain_vs_v0 * 100).toFixed(1) + 'pp',
                pump: r.per_device?.['PUMP-01'] ? (r.per_device['PUMP-01'].accuracy * 100).toFixed(1) + '%' : '—',
                motor: r.per_device?.['MOTOR-02'] ? (r.per_device['MOTOR-02'].accuracy * 100).toFixed(1) + '%' : '—',
                comp: r.per_device?.['COMP-03'] ? (r.per_device['COMP-03'].accuracy * 100).toFixed(1) + '%' : '—',
              }))}
              columns={[
                { title: '变体', dataIndex: 'title', key: 'title' },
                { title: '源域准确率', dataIndex: 'src', key: 'src' },
                { title: '目标域宏平均', dataIndex: 'tgt', key: 'tgt' },
                { title: '相对 V0', dataIndex: 'gain', key: 'gain' },
                { title: '离心泵', dataIndex: 'pump', key: 'pump' },
                { title: '电机', dataIndex: 'motor', key: 'motor' },
                { title: '空压机', dataIndex: 'comp', key: 'comp' },
              ]}
            />
            {data?.conclusion && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#6e7d8b' }}>
                <strong style={{ color: '#477d9e' }}>结论：</strong>
                {data.conclusion}
              </div>
            )}
          </Card>
        </Col>

        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="源域 / 目标域工况差异（域漂移来源）" styles={{ body: cardBodyStyle }}>
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={[
                {
                  key: 'src',
                  isSource: true,
                  name: data?.source_domain?.name ?? 'CWRU 试验台',
                  rpm: data?.source_domain?.profile?.shaft_rpm,
                  fs: data?.source_domain?.profile?.fs,
                  bpfo: data?.source_domain?.freqs?.BPFO,
                  bpfi: data?.source_domain?.freqs?.BPFI,
                  res: data?.source_domain?.profile?.resonance_hz,
                  snr: data?.source_domain?.profile?.snr_db,
                },
                ...devIds.map((d) => {
                  const t = data!.target_domains[d]
                  return {
                    key: d,
                    isSource: false,
                    name: t.name,
                    rpm: t.shaft_rpm,
                    fs: t.fs,
                    bpfo: t.freqs?.BPFO,
                    bpfi: t.freqs?.BPFI,
                    res: t.resonance_hz,
                    snr: t.snr_db,
                  }
                }),
              ]}
              columns={[
                {
                  title: '域',
                  dataIndex: 'name',
                  key: 'name',
                  render: (v: string, r: { isSource: boolean; [key: string]: unknown }) =>
                    r.isSource ? <Tag color="red">{v}（源域）</Tag> : <Tag color="blue">{v}（目标域）</Tag>,
                },
                {
                  title: '转速 (rpm)',
                  dataIndex: 'rpm',
                  key: 'rpm',
                  render: (v: number) => (v == null ? '—' : v.toFixed(0)),
                },
                { title: '采样率 (Hz)', dataIndex: 'fs', key: 'fs', render: (v: number) => (v == null ? '—' : v.toFixed(0)) },
                { title: 'BPFO (Hz)', dataIndex: 'bpfo', key: 'bpfo', render: (v: number) => (v == null ? '—' : v.toFixed(1)) },
                { title: 'BPFI (Hz)', dataIndex: 'bpfi', key: 'bpfi', render: (v: number) => (v == null ? '—' : v.toFixed(1)) },
                { title: '结构共振 (Hz)', dataIndex: 'res', key: 'res', render: (v: number) => (v == null ? '—' : v.toFixed(0)) },
                { title: '信噪比 (dB)', dataIndex: 'snr', key: 'snr', render: (v: number) => (v == null ? '—' : v.toFixed(0)) },
              ]}
            />
            <div style={{ marginTop: 10, fontSize: 12, color: '#6e7d8b' }}>
              每一行都是一种工况：连<strong style={{ color: '#293543' }}>轴承几何</strong>
              （滚珠数 / 滚珠直径 / 节径）都不同，因此同一类故障的特征频率在各设备上落在不同位置 ——
              这正是"实验室模型不敢直接上现场"的根因。
            </div>
          </Card>
        </Col>

        {data?.methods && (
          <Col span={24} style={{ marginTop: 16 }}>
            <Card title="方法说明" styles={{ body: cardBodyStyle }}>
              <Space direction="vertical" size={4} style={{ fontSize: 12, color: '#6e7d8b' }}>
                {Object.entries(data.methods).map(([k, v]) => (
                  <div key={k}>
                    <Tag color={k === 'oracle' ? 'red' : k === 'none' ? 'default' : 'cyan'}>{k}</Tag>
                    {v}
                  </div>
                ))}
              </Space>
            </Card>
          </Col>
        )}
      </Row>
    </Spin></LoadState>
  )
}

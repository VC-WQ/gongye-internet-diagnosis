import { LoadState } from './BusinessUI'
import { errorText } from '../hooks/useResource'
import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Space, Spin, Table, Tag } from 'antd'
import ThemedChart from './ThemedChart'
import { getFpCnnCompare } from '../services/api'
import ChartNote from './ChartNote'
import { xAxisBase, yAxisBase } from '../theme/echarts'

const cardBodyStyle = { padding: 12 }

interface FewShot {
  ratio: number
  n_train: number
  baseline_acc: number
  fp_acc: number
  delta: number
}

interface NoiseItem {
  snr_db: number
  baseline_acc: number
  fp_acc: number
  delta: number
}

interface BandInfo {
  theory_hz: number
  learned_hz: number
  bandwidth_hz: number
  gain: number
}

interface FpCnnData {
  full: { baseline_acc: number; fp_acc: number; delta: number }
  few_shot: FewShot[]
  noise: NoiseItem[]
  confusion: { baseline: number[][]; fp_cnn: number[][] }
  bands: { theory_hz: Record<string, number>; learned: Record<string, BandInfo> }
  config: { epochs: number; device: string; classes: string[]; note: string }
}

const BAND_LABEL: Record<string, string> = {
  BPFO: '外圈故障频率 BPFO',
  BPFI: '内圈故障频率 BPFI',
  BSF: '滚动体故障频率 BSF',
  FTF: '保持架频率 FTF',
}

/**
 * 创新点一：物理频率先验引导 CNN（FP-CNN）。
 *
 * 要解决的是"物理知识与深度学习两张皮"：原方案里 BPFO/BPFI/BSF/FTF 由另一个 Agent
 * 单独算，只在决策层投票拼接；本方案把理论特征频率做成**可学习的高斯频带**嵌进网络，
 * 一方面做频域软掩码增强输入，另一方面把 4 维频带能量与卷积特征拼接后分类 —— 特征级融合。
 *
 * 三块证据：① 少样本（数据稀缺时先验是否帮忙）② 抗噪（先验是否抑制无关频段）
 *          ③ 可解释性（学到的频带是否收敛到理论频率附近）
 */
export default function FPCnnCompare() {
  const [data, setData] = useState<FpCnnData>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    getFpCnnCompare()
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

  // ① 少样本对比
  const fewShotOption = useMemo(() => {
    const fs = data?.few_shot ?? []
    if (!fs.length) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 45 },
      xAxis: xAxisBase({
        type: 'category',
        data: fs.map((f) => `${Math.round(f.ratio * 100)}%\n(${f.n_train} 样本)`),
        name: '训练数据比例',
        nameLocation: 'middle',
        nameGap: 42,
      }),
      yAxis: yAxisBase({ type: 'value', name: '测试准确率', min: 0, max: 1, nameLocation: 'middle', nameGap: 34 }),
      series: [
        {
          name: '基线 1D-CNN',
          type: 'bar',
          data: fs.map((f) => f.baseline_acc),
          itemStyle: { color: '#64748b' },
          label: { show: true, position: 'top', formatter: (p: { value: number }) => p.value.toFixed(3) },
        },
        {
          name: 'FP-CNN（物理先验）',
          type: 'bar',
          data: fs.map((f) => f.fp_acc),
          itemStyle: { color: '#477d9e' },
          label: { show: true, position: 'top', formatter: (p: { value: number }) => p.value.toFixed(3) },
        },
      ],
    }
  }, [data])

  // ② 抗噪对比
  const noiseOption = useMemo(() => {
    const ns = data?.noise ?? []
    if (!ns.length) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 45 },
      xAxis: xAxisBase({
        type: 'category',
        data: ns.map((n) => `${n.snr_db} dB`),
        name: '测试集叠加噪声（SNR 越低噪声越强）',
        nameLocation: 'middle',
        nameGap: 42,
      }),
      yAxis: yAxisBase({ type: 'value', name: '测试准确率', min: 0, max: 1, nameLocation: 'middle', nameGap: 34 }),
      series: [
        {
          name: '基线 1D-CNN',
          type: 'line',
          smooth: true,
          symbolSize: 8,
          data: ns.map((n) => n.baseline_acc),
          lineStyle: { color: '#64748b' },
          itemStyle: { color: '#64748b' },
        },
        {
          name: 'FP-CNN（物理先验）',
          type: 'line',
          smooth: true,
          symbolSize: 8,
          data: ns.map((n) => n.fp_acc),
          lineStyle: { color: '#477d9e' },
          itemStyle: { color: '#477d9e' },
        },
      ],
    }
  }, [data])

  // ③ 学到的频带 vs 理论频率
  const bandOption = useMemo(() => {
    const learned = data?.bands?.learned
    if (!learned) return {}
    const keys = Object.keys(learned)
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 45 },
      xAxis: xAxisBase({ type: 'category', data: keys }),
      yAxis: yAxisBase({ type: 'value', name: '频率 (Hz)', nameLocation: 'middle', nameGap: 34 }),
      series: [
        {
          name: '理论频率（由轴承几何解析计算）',
          type: 'bar',
          data: keys.map((k) => learned[k].theory_hz),
          itemStyle: { color: '#64748b' },
        },
        {
          name: '网络学到的频带中心',
          type: 'bar',
          data: keys.map((k) => learned[k].learned_hz),
          itemStyle: { color: '#477d9e' },
        },
      ],
    }
  }, [data])

  const bestFewShot = useMemo(() => {
    const fs = data?.few_shot ?? []
    if (!fs.length) return undefined
    return fs.reduce((a, b) => (b.delta > a.delta ? b : a))
  }, [data])

  const bestNoise = useMemo(() => {
    const ns = data?.noise ?? []
    if (!ns.length) return undefined
    return ns.reduce((a, b) => (b.delta > a.delta ? b : a))
  }, [data])

  return (
    <LoadState loading={loading} error={loadError} onRetry={() => window.location.reload()}><Spin spinning={false}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 12 }}>
          <Space size={8} wrap>
            <Tag color="cyan">FP-CNN</Tag>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              把轴承理论特征频率（BPFO / BPFI / BSF / FTF）做成可学习高斯频带嵌入 CNN，
              实现物理知识与深度学习的<strong style={{ color: "var(--text)" }}>特征级</strong>融合
            </span>
          </Space>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="少样本学习对比（训练数据稀缺时）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="把训练集按 50% / 20% / 10% 抽样后分别训练两个模型，在同一测试集上比较准确率。"
                dataSource="CWRU 轴承振动数据集（真实公开数据），两模型使用完全相同的数据划分、随机种子与训练轮数。"
                insight={
                  bestFewShot
                    ? `数据越少，物理先验的补偿越明显：训练数据降到 ${Math.round(bestFewShot.ratio * 100)}% 时，FP-CNN 相对基线 ${bestFewShot.delta >= 0 ? '+' : ''}${(bestFewShot.delta * 100).toFixed(1)} 个百分点。`
                    : '数据越少，物理先验对数据稀缺的补偿作用通常越明显。'
                }
              />
            }
          >
            {data?.few_shot?.length ? (
              <ThemedChart option={fewShotOption} style={{ height: 280 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="抗噪鲁棒性对比（测试集叠加噪声）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="在测试集上叠加 SNR = 10 / 5 / 0 / -5 dB 的高斯噪声，观察两个模型的准确率衰减。"
                dataSource="CWRU 轴承振动数据集（真实公开数据），噪声直接叠加在原始振动波形上，模型不做任何重新训练。"
                insight={
                  bestNoise
                    ? `强噪声下先验频带起到"带通滤波"作用：SNR=${bestNoise.snr_db}dB 时 FP-CNN ${bestNoise.delta >= 0 ? '+' : ''}${(bestNoise.delta * 100).toFixed(1)} 个百分点。`
                    : '噪声越强，物理频带掩码抑制无关频段的作用越明显。'
                }
              />
            }
          >
            {data?.noise?.length ? (
              <ThemedChart option={noiseOption} style={{ height: 280 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12} style={{ marginTop: 16 }}>
          <Card
            title="可解释性：学到的频带 vs 理论频率"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="FP-CNN 训练后四个可学习频带的中心频率，与由轴承几何（滚珠数 / 滚珠直径 / 节径）解析计算的理论特征频率对照。"
                dataSource="CWRU 驱动端 SKF-6205 深沟球轴承（n=9, d=7.94mm, D=39.04mm, 1797rpm）解析计算值 + 网络训练后学到的中心。"
                insight="两者越接近，说明网络确实「学到」了物理规律而不是死记数据；偏差则反映真实故障频率受滑动、载荷等因素影响而偏离理论值。"
              />
            }
          >
            {data?.bands?.learned ? (
              <ThemedChart option={bandOption} style={{ height: 280 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12} style={{ marginTop: 16 }}>
          <Card title="频带学习明细 + 全量数据结论" styles={{ body: cardBodyStyle }}>
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={
                data?.bands?.learned
                  ? Object.entries(data.bands.learned).map(([k, v]) => ({
                      key: k,
                      label: BAND_LABEL[k] ?? k,
                      theory: v.theory_hz.toFixed(2),
                      learned: v.learned_hz.toFixed(2),
                      bandwidth: v.bandwidth_hz.toFixed(2),
                      gain: v.gain.toFixed(3),
                    }))
                  : []
              }
              columns={[
                { title: '频带', dataIndex: 'label', key: 'label' },
                { title: '理论 (Hz)', dataIndex: 'theory', key: 'theory' },
                { title: '学到 (Hz)', dataIndex: 'learned', key: 'learned' },
                { title: '带宽 (Hz)', dataIndex: 'bandwidth', key: 'bandwidth' },
                { title: '增益', dataIndex: 'gain', key: 'gain' },
              ]}
            />
            {data?.full && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                全量数据下：基线 {(data.full.baseline_acc * 100).toFixed(2)}% vs FP-CNN{' '}
                {(data.full.fp_acc * 100).toFixed(2)}%（Δ {data.full.delta >= 0 ? '+' : ''}
                {(data.full.delta * 100).toFixed(2)} 个百分点）。
                {data.config?.note ? ` ${data.config.note}` : ''}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </Spin></LoadState>
  )
}

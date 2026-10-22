import { LoadState } from './BusinessUI'
import { useResearchSource } from '../features/about/ResearchDataContext'
import { useMemo } from 'react'
import { Card, Col, Empty, Row, Space, Spin, Statistic } from 'antd'
import ThemedChart from './ThemedChart'
import { getCwruSignal } from '../services/api'
import ChartNote from './ChartNote'

const cardBodyStyle = { padding: 12 }

// 4 类故障统一色标
const CLS_COLOR: Record<string, string> = {
  Normal: '#348875',
  IR: '#bf5965',
  OR: '#9a6a25',
  Ball: '#477d9e',
}
const CLS_ORDER = ['Normal', 'IR', 'OR', 'Ball']

interface CwruSignal {
  overview: {
    n_samples: number
    fs: number
    class_dist: Array<{ name: string; label: string; value: number }>
    severity_dist: Array<{ name: string; value: number }>
  }
  time_domain: {
    waves: Array<{ name: string; label: string; t_ms: number[]; wave: number[] }>
  }
  frequency_domain: {
    freqs: number[]
    spectra: Array<{ name: string; label: string; freqs: number[]; amp: number[] }>
  }
  tsne: { points: Array<[number, number]>; labels: string[]; class_names: string[] }
  severity_heatmap: { freqs: number[]; rows: string[]; matrix: number[][] }
}

/**
 * CWRU 轴承故障「信号层」诊断（经典故障诊断方法论实证）。
 *
 * 四块证据链，覆盖信号处理的完整链路（互不重复、四种图表）：
 *   ① 时域波形（2×2 子图）      —— 时域冲击差异
 *   ② 频域幅值谱（4 类叠加）    —— 特征频率差异
 *   ③ t-SNE 特征空间（散点）    —— 特征可分性（ML-ready 的直接证据）
 *   ④ 严重度梯度（热力图）      —— 故障直径↑ → 特征频率能量↑
 * 结论落点：从时域→频域→特征空间，论证「振动信号即可诊断轴承故障」。
 */
export default function CwruSignal() {
  const { data, loading, error: loadError } = useResearchSource<CwruSignal>('cwru-signal', getCwruSignal)

  // -----------------------------------------------------------------------
  // ① 时域波形 2×2 子图
  // -----------------------------------------------------------------------
  // 2×2 四子图布局（左上 Normal / 右上 IR / 左下 OR / 右下 Ball）
  const WAVE_GRID = [
    { left: '6%', top: 42, right: '52%', height: 95 },
    { left: '54%', top: 42, right: '6%', height: 95 },
    { left: '6%', top: 192, right: '52%', height: 95 },
    { left: '54%', top: 192, right: '6%', height: 95 },
  ]

  const waveOption = useMemo(() => {
    const waves = data?.time_domain?.waves ?? []
    if (!waves.length) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, data: waves.map((w) => w.label) },
      grid: WAVE_GRID,
      xAxis: waves.map((_, i) => ({
        type: 'value' as const,
        gridIndex: i,
        axisLabel: { fontSize: 9 },
        splitLine: { show: false },
      })),
      yAxis: waves.map((_, i) => ({
        type: 'value' as const,
        gridIndex: i,
        scale: true,
        axisLabel: { fontSize: 9 },
      })),
      series: waves.map((w, i) => ({
        name: w.label,
        type: 'line',
        showSymbol: false,
        xAxisIndex: i,
        yAxisIndex: i,
        data: w.t_ms.map((t, j) => [t, w.wave[j]]),
        lineStyle: { color: CLS_COLOR[w.name], width: 1.2 },
        itemStyle: { color: CLS_COLOR[w.name] },
      })),
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ② 频域幅值谱（4 类叠加对比）
  // -----------------------------------------------------------------------
  const specOption = useMemo(() => {
    const spectra = data?.frequency_domain?.spectra ?? []
    if (!spectra.length) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 25, top: 32, bottom: 40 },
      xAxis: { type: 'value', name: '频率(Hz)' },
      yAxis: { type: 'value', name: '归一化幅值', max: 1 },
      series: spectra.map((s) => ({
        name: s.label,
        type: 'line',
        showSymbol: false,
        smooth: false,
        data: s.freqs.map((f, j) => [f, s.amp[j]]),
        lineStyle: { color: CLS_COLOR[s.name], width: 1.5 },
        itemStyle: { color: CLS_COLOR[s.name] },
      })),
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ③ t-SNE 特征空间散点
  // -----------------------------------------------------------------------
  const tsneOption = useMemo(() => {
    const ts = data?.tsne
    if (!ts?.points?.length) return {}
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `${p.seriesName}<br/>(${p.value[0]}, ${p.value[1]})`,
      },
      legend: { top: 0 },
      grid: { left: 50, right: 25, top: 32, bottom: 40 },
      xAxis: { type: 'value', name: 't-SNE-1', axisLabel: { show: false } },
      yAxis: { type: 'value', name: 't-SNE-2', axisLabel: { show: false } },
      series: ts.class_names.map((cls) => ({
        name: CLS_ORDER.includes(cls) ? cls : cls,
        type: 'scatter' as const,
        symbolSize: 5,
        data: ts.points.filter((_, i) => ts.labels[i] === cls),
        itemStyle: { color: CLS_COLOR[cls] ?? '#6e7d8b', opacity: 0.65 },
      })),
    }
  }, [data])

  // -----------------------------------------------------------------------
  // ④ 严重度梯度热力图（行=故障直径，列=频率，值=归一化平均幅值）
  // -----------------------------------------------------------------------
  const sevOption = useMemo(() => {
    const h = data?.severity_heatmap
    if (!h?.matrix?.length) return {}
    const heat: Array<[number, number, number]> = []
    h.matrix.forEach((row, i) => row.forEach((v, j) => heat.push([j, i, v])))
    return {
      tooltip: { position: 'top', valueFormatter: (v: number) => v.toFixed(3) },
      grid: { left: 70, right: 25, top: 20, bottom: 45 },
      xAxis: {
        type: 'category',
        data: h.freqs.map((f) => f.toFixed(0)),
        name: '频率(Hz)',
        nameLocation: 'end',
        axisLabel: { interval: 20 },
      },
      yAxis: { type: 'category', data: h.rows },
      visualMap: {
        min: 0,
        max: 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#eee7dd', '#849aa4', '#b6535c'] },
      },
      series: [{ type: 'heatmap', data: heat, label: { show: false } }],
    }
  }, [data])

  return (
    <LoadState loading={loading} error={loadError} onRetry={() => window.location.reload()}><Spin spinning={false}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--status-info)" }}>
            CWRU 轴承故障·信号诊断（时域 → 频域 → 特征空间，经典方法论实证）
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {data
              ? `${data.overview.n_samples.toLocaleString()} 段驱动端振动信号（12kHz，4 类故障 × 3 种故障直径）`
              : ''}
          </div>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="① 时域波形对比（振动加速度，g）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="正常 / 内圈 / 外圈 / 滚动体四类状态的驱动端振动加速度时域波形（2×2 子图）。"
                dataSource="CWRU 凯斯西储大学轴承故障数据集（12kHz 采样 · 真实公开数据）。"
                insight="不同故障类型的冲击脉冲在时域形态上呈现差异。"
              />
            }
          >
            {data ? (
              <ThemedChart option={waveOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="② 频域幅值谱对比（特征频率区）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="四类状态振动信号的频域幅值谱叠加对比，突出故障特征频率区的差异。"
                dataSource="CWRU 凯斯西储大学轴承故障数据集（FFT 频谱分析 · 真实公开数据）。"
                insight="比较四类状态的频谱差异；特征峰可辅助诊断，分类效果仍需独立测试。"
              />
            }
          >
            {data ? (
              <ThemedChart option={specOption} style={{ height: 300 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12} style={{ marginTop: 16 }}>
          <Card
            title="③ 特征空间可分性（PCA→t-SNE）"
            styles={{ body: cardBodyStyle }}
            extra={
              data ? (
                <Space size={16}>
                  <Statistic
                    title="嵌入样本"
                    value={data.tsne.points.length}
                    valueStyle={{ fontSize: 18, color: "var(--status-info)" }}
                  />
                  <ChartNote
                    desc="将高维振动特征经 PCA 降维后做 t-SNE 嵌入到二维空间，观察四类故障的可分性。"
                    dataSource="CWRU 凯斯西储大学轴承故障数据集（特征降维嵌入 · 真实公开数据）。"
                    insight="二维嵌入用于观察样本分布；簇分离不能单独证明分类性能或泛化能力。"
                  />
                </Space>
              ) : (
                <ChartNote
                  desc="将高维振动特征做 t-SNE 二维嵌入，观察四类故障的可分性。"
                  dataSource="CWRU 凯斯西储大学轴承故障数据集（真实公开数据）。"
                  insight="二维嵌入用于观察样本分布；分类性能需在独立测试集上评估。"
                />
              )
            }
          >
            {data ? (
              <ThemedChart option={tsneOption} style={{ height: 320 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12} style={{ marginTop: 16 }}>
          <Card
            title="④ 不同内圈故障直径的频率能量"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="内圈故障在不同故障直径（0.007 至 0.021 英寸）下，各频率处的归一化平均能量热力图。"
                dataSource="CWRU 凯斯西储大学轴承故障数据集（3 种故障直径梯度 · 真实公开数据）。"
                insight="比较不同故障直径下的归一化能量分布，不将所有频率的变化概括为单调关系。"
              />
            }
          >
            {data ? (
              <ThemedChart option={sevOption} style={{ height: 320 }} />
            ) : (
              <Empty description="暂无实验结果" />
            )}
          </Card>
        </Col>
      </Row>
    </Spin></LoadState>
  )
}

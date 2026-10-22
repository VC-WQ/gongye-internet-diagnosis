import { memo, useId, useMemo, useLayoutEffect, useState } from 'react'
import FlipText from '../../motion/FlipText'
import { signalStage, twinStage, domainStage, sharedLife } from './stagePlots'
import ThemedChart from '../../components/ThemedChart'
import { figureEvidence, type EvidenceMap } from './dataContract'
import { PROVENANCE } from './research'
import type { ResearchScene } from './stageTimeline'
import { stageEvidence } from './stageEvidence'
import { EvidenceBadge } from './ResearchOverview'
import { xAxisBase, yAxisBase } from '../../theme/echarts'

const QUESTIONS: Record<string, [string, string, string]> = {
  signal: ['来源登记', '信号观察', '特征核验'], diagnosis: ['物理先验', '同协议对照', '目标域适配'],
  health: ['退化状态', '在线更新', '寿命评估'], mechanism: ['异常事件', '人工处置', '复盘阈值'],
  results: ['任务边界', '指标核验', '来源复核'],
}
function MethodDiagram({ scene }: { scene: ResearchScene }) {
  const steps = QUESTIONS[scene.topic?.id ?? 'signal']
  return <div className="stage-method" aria-label={`${scene.title}方法关系示意，不表示测量数值`}>
    <div className="stage-method__line" aria-hidden="true" />
    {steps.map((step, i) => <div className={`stage-method__node stage-method__node--${i}`} key={step}><span>0{i + 1}</span><strong>{step}</strong><small>{i === 0 ? '明确输入与适用范围' : i === 1 ? '保持协议与设备身份' : '回到结果与证据来源'}</small></div>)}
    <p>方法关系示意 · 不代表实时控制流程或实验精度</p>
  </div>
}

function EvidencePlot({ scene, evidence, lifeReveal }: { scene: ResearchScene; evidence: EvidenceMap; lifeReveal?: number }) {
  const [compact, setCompact] = useState(() => matchMedia('(max-width:740px)').matches)
  useLayoutEffect(() => { const media = matchMedia('(max-width:740px)'); const update = () => setCompact(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  const figure = scene.point?.figure ?? (!scene.topic ? 'cwru-signal' : undefined)
  const plot = useMemo(() => figure ? stageEvidence(figure, evidence) : undefined, [figure, evidence])
  const option = useMemo(() => {
    if (!plot) return {}
    const data = figure ? evidence[figure]?.data : undefined
    if (data && figure === 'cwru-signal') return signalStage(data, compact)
    if (data && figure === 'digital-twin-phm') return twinStage(data, compact)
    if (data && figure === 'domain-adapt') return domainStage(data, compact)
    const categories = plot.category ? [...new Set(plot.series.flatMap(series => series.data.map(([x]) => String(x))))] : undefined
    return {
      animation: false, tooltip: { trigger: 'axis', confine: true }, legend: { top: 0, type: 'scroll' },
      grid: { left: 70, right: 24, top: 47, bottom: plot.category ? 75 : 55 },
      xAxis: xAxisBase({ type: plot.category ? 'category' : 'value', data: categories, name: plot.x, nameLocation: 'middle', nameGap: plot.category ? 53 : 30,
        axisLabel: { fontSize: 10, rotate: plot.category ? 18 : 0, hideOverlap: true } }),
      yAxis: yAxisBase({ type: 'value', name: plot.y, nameTextStyle: { fontSize: 10 }, scale: !plot.category }),
      series: plot.series.map((series, i) => ({ id: series.name, name: series.name, type: series.type, showSymbol: false,
        data: categories ? categories.map(category => series.data.find(([x]) => String(x) === category)?.[1] ?? null) : series.data,
        itemStyle: { color: i ? '#477d9e' : '#b24b55' }, lineStyle: { width: 2, color: i ? '#477d9e' : '#b24b55' } })),
    }
  }, [plot, figure, evidence, compact])
  if (figure === 'xjtu-rul' || figure === 'rul-sde-pf') return <LifePlot evidence={evidence} reveal={lifeReveal ?? (figure === 'rul-sde-pf' ? 1 : 0)} fallback={option} compact={compact} />
  if (!plot) return <MethodDiagram scene={scene} />
  return <figure className="stage-plot" aria-label={plot.title}>
    <figcaption>{figure === 'cwru-signal' ? compact ? 'CWRU · 时域与频谱（特征空间见完整实验）' : 'CWRU · 时域、频谱与特征空间' : figure === 'digital-twin-phm' ? '孪生泵 · 退化事件与 TTF 预测' : figure === 'domain-adapt' ? '跨域迁移 · 逐设备结果与方法对照' : plot.title}</figcaption>
    <ThemedChart notMerge option={option} style={{ height: '100%', minHeight: 180 }} />
    <p>{plot.note}</p>
  </figure>
}

/** Shared real RUL stays mounted. Forecasts reveal spatially; null gaps remain gaps. */
function LifePlot({ evidence, reveal, fallback, compact }: { evidence: EvidenceMap; reveal: number; fallback: object; compact: boolean }) {
  const clip = useId().replace(/:/g, '')
  const geometry = useMemo(() => sharedLife(evidence['xjtu-rul']?.status === 'available' ? evidence['xjtu-rul'].data : undefined, evidence['rul-sde-pf']?.status === 'available' ? evidence['rul-sde-pf'].data : undefined), [evidence])
  if (!geometry) return <figure className="stage-plot"><figcaption>寿命证据 · 当前数据采用独立坐标</figcaption><ThemedChart notMerge option={fallback} style={{ height: '100%' }} /><p>身份或逐点对应未核验，不进行共享形变。</p></figure>
  const width = compact ? 400 : 1000, span = width - 120
  return <figure className="stage-plot stage-life" data-life-bearing={geometry.id} data-life-reveal={reveal.toFixed(4)}>
    <figcaption>{geometry.id} · 全寿命退化 → SDE + 粒子滤波预测</figcaption>
    <svg viewBox={`0 0 ${width} 330`} preserveAspectRatio="none" role="img" aria-label={`${geometry.id}，${geometry.count} 个采样点，时间单位为分钟；实际 RUL 固定，预测随滚动显露`}>
      <defs><clipPath id={clip}><rect x="60" y="25" width={880 * reveal} height="255" /></clipPath></defs>
      {[0, .25, .5, .75, 1].map(y => <g key={y}><line x1="60" x2={60+span} y1={280-y*240} y2={280-y*240} stroke="var(--line)" /><text x="48" y={284-y*240} textAnchor="end">{y}</text></g>)}
      {[0, .25, .5, .75, 1].map(x => <text key={x} x={60+x*span} y="302" textAnchor="middle">{(geometry.end*x).toFixed(1)}</text>)}
      <text x="60" y="20">归一化指标（0–1）</text><text x={width/2} y="325" textAnchor="middle">时间（分钟）</text>
      <g transform={`translate(60 0) scale(${span/880} 1) translate(-60 0)`}>
      <path data-life-actual d={geometry.actual} fill="none" stroke="#bf5965" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <path d={geometry.hi} opacity={1-reveal} fill="none" stroke="#348875" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <g clipPath={`url(#${clip})`}><path d={geometry.forecast} fill="none" stroke="#477d9e" strokeWidth="2" vectorEffect="non-scaling-stroke" /><path d={geometry.baseline} fill="none" stroke="#9a6a25" strokeDasharray="5 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></g>
      </g>
    </svg>
    <p><span style={{color:'#bf5965'}}>实际 RUL</span> · <span style={{color:'#348875'}}>HI</span> · <span style={{color:'#477d9e'}}>SDE/PF</span> · <span style={{color:'#9a6a25'}}>指数基线</span>。按同一轴承逐点核验后，以采样点原始分钟坐标对齐；缺失预测保留断线。完整详情保留原始百分比坐标与负 R²。</p>
  </figure>
}

/** Memoized scene content; scroll only changes its compositor-owned wrapper. */
export default memo(function ResearchStageScene({ scene, evidence, includeRuntime, onDetails, onRetry, lifeReveal }: {
  lifeReveal?: number; scene: ResearchScene; evidence: EvidenceMap; includeRuntime: boolean; onDetails: (id: string) => void; onRetry: () => void
}) {
  const figure = scene.point?.figure ?? (!scene.topic ? 'cwru-signal' : undefined)
  const source = figure ? PROVENANCE[figure] : undefined
  const entry = figure ? figureEvidence(figure, evidence) : undefined
  const privateRuntime = figure === 'self-evolution-loop' && !includeRuntime
  const unavailable = figure && entry?.status !== 'available' && figure !== 'self-evolution-loop'
  return <div className="stage-scene__content">
    <header className="stage-scene__title"><span>{scene.index} / {scene.point ? '研究证据' : '研究方向'}</span><h2><FlipText value={scene.title} /></h2><p>{scene.summary}</p></header>
    <div className="stage-scene__visual" data-stage-visual>
      {unavailable ? <div className="stage-unavailable" role="status"><strong>{entry?.status === 'loading' || !entry ? '正在核验研究数据' : '本项证据暂未就绪'}</strong><p>{entry?.message ?? '由已登记接口读取，不生成替代数值。'}</p>{entry?.status !== 'loading' && <button type="button" onClick={onRetry}>重新核验</button>}</div> : <EvidencePlot scene={scene} evidence={evidence} lifeReveal={lifeReveal} />}
    </div>
    <footer className="stage-scene__source"><div><strong>{source?.source ?? '研究目录与方法说明'}</strong><span>{privateRuntime ? '运行统计需登录；此处仅说明机制' : source ? <EvidenceBadge status={entry?.status} /> : '方法关系示意 · 无测量数值'}</span></div><button type="button" onClick={() => onDetails(scene.id)}>{scene.point ? '查看完整实验与来源' : '查看方向与证据'} <span aria-hidden="true">↗</span></button></footer>
  </div>
})

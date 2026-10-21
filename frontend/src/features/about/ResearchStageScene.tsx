import { memo, useMemo } from 'react'
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

function EvidencePlot({ scene, evidence }: { scene: ResearchScene; evidence: EvidenceMap }) {
  const figure = scene.point?.figure ?? (!scene.topic ? 'classification' : undefined)
  const plot = useMemo(() => figure ? stageEvidence(figure, evidence) : undefined, [figure, evidence])
  const option = useMemo(() => {
    if (!plot) return {}
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
  }, [plot])
  if (!plot) return <MethodDiagram scene={scene} />
  return <figure className="stage-plot" aria-label={plot.title}>
    <figcaption>{plot.title}</figcaption>
    <ThemedChart option={option} style={{ height: '100%', minHeight: 180 }} />
    <p>{plot.note}</p>
  </figure>
}

/** Memoized scene content; scroll only changes its compositor-owned wrapper. */
export default memo(function ResearchStageScene({ scene, evidence, includeRuntime, onDetails, onRetry }: {
  scene: ResearchScene; evidence: EvidenceMap; includeRuntime: boolean; onDetails: (id: string) => void; onRetry: () => void
}) {
  const figure = scene.point?.figure ?? (!scene.topic ? 'classification' : undefined)
  const source = figure ? PROVENANCE[figure] : undefined
  const entry = figure ? figureEvidence(figure, evidence) : undefined
  const privateRuntime = figure === 'self-evolution-loop' && !includeRuntime
  const unavailable = figure && entry?.status !== 'available' && figure !== 'self-evolution-loop'
  return <div className="stage-scene__content">
    <header className="stage-scene__title"><span>{scene.index} / {scene.point ? '研究证据' : '研究方向'}</span><h2>{scene.title}</h2><p>{scene.summary}</p></header>
    <div className="stage-scene__visual" data-stage-visual>
      {unavailable ? <div className="stage-unavailable" role="status"><strong>{entry?.status === 'loading' || !entry ? '正在核验研究数据' : '本项证据暂未就绪'}</strong><p>{entry?.message ?? '由已登记接口读取，不生成替代数值。'}</p>{entry?.status !== 'loading' && <button type="button" onClick={onRetry}>重新核验</button>}</div> : <EvidencePlot scene={scene} evidence={evidence} />}
    </div>
    <footer className="stage-scene__source"><div><strong>{source?.source ?? '研究目录与方法说明'}</strong><span>{privateRuntime ? '运行统计需登录；此处仅说明机制' : source ? <EvidenceBadge status={entry?.status} /> : '方法关系示意 · 无测量数值'}</span></div><button type="button" onClick={() => onDetails(scene.id)}>{scene.point ? '查看完整实验与来源' : '查看方向与证据'} <span aria-hidden="true">↗</span></button></footer>
  </div>
})

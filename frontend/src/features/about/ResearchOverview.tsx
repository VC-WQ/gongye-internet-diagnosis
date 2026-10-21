import { useMemo } from 'react'
import { Alert } from 'antd'
import ThemedChart from '../../components/ThemedChart'
import { SourceTag } from '../../components/BusinessUI'
import FlipValue from '../../motion/FlipValue'
import { xAxisBase, yAxisBase } from '../../theme/echarts'
import { RESEARCH_TOPICS } from './research'
import { comparisonRows, figureEvidence, finite, STATUS_LABEL, type EvidenceMap, type EvidenceStatus, type JsonRecord } from './dataContract'
import ResearchLink from './ResearchLink'
import { pointAnchor } from './researchNavigation'
import { MOTION } from '../../motion/tokens'

const metricText = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
export function EvidenceBadge({ status = 'loading' }: { status?: EvidenceStatus }) {
  return <span className={`research-evidence-status is-${status}`}><i aria-hidden="true" />{STATUS_LABEL[status]}</span>
}

export default function ResearchOverview({ evidence, refresh, includeRuntime }: { evidence: EvidenceMap; refresh: () => void; includeRuntime: boolean }) {
  const points = RESEARCH_TOPICS.flatMap(topic => topic.points)
  const figures = points.flatMap(point => point.figure && (includeRuntime || point.figure !== 'self-evolution-loop') ? [point.figure] : [])
  const ready = figures.filter(figure => figureEvidence(figure, evidence).status === 'available').length
  const datasets: JsonRecord[] = evidence['dataset-registry']?.status === 'available' ? evidence['dataset-registry'].data?.datasets ?? [] : []
  const classification = evidence.classification?.status === 'available' ? evidence.classification.data?.datasets?.[0] : undefined
  const steam = evidence.steam?.status === 'available' ? evidence.steam.data : undefined
  const classificationBest = classification?.models.reduce((best: JsonRecord | undefined, item: JsonRecord) => !best || item.f1 > best.f1 ? item : best, undefined)
  const steamBest = steam?.methods.reduce((best: JsonRecord | undefined, item: JsonRecord) => !best || item.r2 > best.r2 ? item : best, undefined)
  const rul = evidence['rul-sde-pf']?.status === 'available' ? evidence['rul-sde-pf'].data : undefined
  const failures = figures.filter(figure => ['error', 'incomplete'].includes(figureEvidence(figure, evidence).status))
  const classificationOption = useMemo(() => ({
    animation: true, animationDuration: MOTION.researchReveal.duration, animationDurationUpdate: MOTION.researchChart.update,
    tooltip: { trigger: 'axis' }, legend: { top: 0 },
    grid: { left: 46, right: 12, top: 34, bottom: 68 },
    xAxis: xAxisBase({ type: 'category', data: classification?.models.map((m: JsonRecord) => m.name) ?? [], axisLabel: { rotate: 22, fontSize: 10 } }),
    yAxis: yAxisBase({ type: 'value', name: '评分（0–1）', min: 0, max: 1 }),
    series: ['f1', 'auc'].map((metric, index) => ({ name: index ? 'AUC' : 'F1', type: 'bar', data: classification?.models.map((m: JsonRecord) => m[metric]) ?? [], itemStyle: { color: index ? '#477d9e' : '#b24b55' } })),
  }), [classification])
  const regressionOption = useMemo(() => ({
    animation: true, animationDuration: MOTION.researchReveal.duration, animationDurationUpdate: MOTION.researchChart.update,
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 12, top: 28, bottom: 68 },
    xAxis: xAxisBase({ type: 'category', data: steam?.methods.map((m: JsonRecord) => m.name) ?? [], axisLabel: { rotate: 22, fontSize: 10 } }),
    yAxis: yAxisBase({ type: 'value', name: 'R²（可为负）', scale: true }),
    series: [{ name: 'R²', type: 'bar', data: steam?.methods.map((m: JsonRecord) => m.r2) ?? [], itemStyle: { color: '#348875' } }],
  }), [steam])

  return <div className="research-overview" data-research-overview>
    <div className="research-overview__intro">
      <p>从原始信号、物理先验到寿命预测与事件闭环，把方法、结果与来源放在同一条证据链上阅读。</p>
      <div className="research-overview__source"><SourceTag source="offline_experiment" /><span>公开数据与仿真实验分别标注{includeRuntime ? '；运行统计来自当前数据库' : '；公开入口不读取运行统计'}。</span><button type="button" onClick={refresh}>重新核验</button></div>
    </div>
    <dl className="research-metrics" aria-label="研究规模与当前数据状态">
      {[
        ['研究方向', String(RESEARCH_TOPICS.length), '贯穿数据、算法与工程'],
        ['研究点', String(points.length), '包含真实证据索引'],
        ['登记数据集', evidence['dataset-registry']?.status === 'available' ? String(datasets.length) : '—', '取自数据资产登记'],
        ['可用证据', `${ready} / ${figures.length}`, includeRuntime ? '已接图形的结构核验' : '公开证据；另有登录统计'],
      ].map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd><FlipValue value={value} /></dd><small>{note}</small></div>)}
    </dl>
    <div className="research-overview-charts" aria-label="首屏代表实验">
      <section className="research-overview-chart"><h3>{classification?.name ?? '表格分类'} · F1 / AUC</h3><p>同一数据集模型横评，数值直接取分类接口</p>{classification ? <ThemedChart option={classificationOption} style={{ height: 230 }} /> : <div className="research-chart-empty" role="status">{evidence.classification?.message ?? '正在核验分类实验数据'}</div>}<ResearchLink anchor={pointAnchor('results', 'classification')}>查看混淆矩阵、ROC 与特征重要性 →</ResearchLink></section>
      <section className="research-overview-chart"><h3>工业蒸汽量预测 · R²</h3><p>保留负值与真实模型差异，不跨任务排名</p>{steam ? <ThemedChart option={regressionOption} style={{ height: 230 }} /> : <div className="research-chart-empty" role="status">{evidence.steam?.message ?? '正在核验回归实验数据'}</div>}<ResearchLink anchor={pointAnchor('results', 'steam')}>查看预测、误差与传感器相关性 →</ResearchLink></section>
    </div>
    <div className="research-featured-results" aria-label="当前离线实验快照">
      <ResearchLink anchor={pointAnchor('results', 'classification')}><span>表格分类 · 最佳 F1</span><strong>{finite(classificationBest?.f1) ? metricText(classificationBest.f1) : '—'}</strong><small>{classification?.name ?? '等待实验数据'} · {classificationBest?.name ?? '模型未就绪'}</small></ResearchLink>
      <ResearchLink anchor={pointAnchor('results', 'steam')}><span>蒸汽量回归 · 最佳 R²</span><strong>{finite(steamBest?.r2) ? metricText(steamBest.r2) : '—'}</strong><small>{steamBest?.name ?? '模型未就绪'} · 同任务内比较</small></ResearchLink>
      <ResearchLink anchor={pointAnchor('health', 'rul')}><span>寿命预测 · SDE + PF RMSE</span><strong>{finite(rul?.metrics?.sde_pf?.rmse) ? metricText(rul.metrics.sde_pf.rmse) : '—'}</strong><small>XJTU-SY · 归一化剩余寿命误差</small></ResearchLink>
    </div>
    <p className="research-section__note">横评结果共 {comparisonRows(evidence).length} 个模型与任务组合。首屏呈现代表性简图，后文保留完整实验与方法；未提供时间戳的产物不推定更新时间。</p>
    {failures.length > 0 && <Alert type="warning" showIcon message={`${failures.length} 个证据源未就绪，其余研究继续展示；缺失状态可在证据索引复核。`} />}
  </div>
}

import { useMemo } from 'react'
import { Alert, Table } from 'antd'
import { Link } from 'react-router-dom'
import ThemedChart from '../../components/ThemedChart'
import { SourceTag } from '../../components/BusinessUI'
import { xAxisBase, yAxisBase } from '../../theme/echarts'
import { PROVENANCE, RESEARCH_TOPICS } from './research'
import { comparisonRows, figureEvidence, finite, sourceBreakdown, STATUS_LABEL, type EvidenceMap, type EvidenceStatus, type JsonRecord } from './dataContract'

const n = (value: unknown) => finite(value) ? value.toLocaleString('zh-CN') : '—'
const metricText = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
export function EvidenceBadge({ status = 'loading' }: { status?: EvidenceStatus }) {
  return <span className={`research-evidence-status is-${status}`}><i aria-hidden="true" />{STATUS_LABEL[status]}</span>
}

export default function ResearchOverview({ evidence, refresh }: { evidence: EvidenceMap; refresh: () => void }) {
  const points = RESEARCH_TOPICS.flatMap(topic => topic.points)
  const figures = points.flatMap(point => point.figure ? [point.figure] : [])
  const ready = figures.filter(figure => figureEvidence(figure, evidence).status === 'available').length
  const settled = figures.filter(figure => figureEvidence(figure, evidence).status !== 'loading').length
  const datasets: JsonRecord[] = evidence['dataset-registry']?.status === 'available' ? evidence['dataset-registry'].data?.datasets ?? [] : []
  const sources = sourceBreakdown(datasets)
  const models = comparisonRows(evidence)
  const classification = evidence.classification?.status === 'available' ? evidence.classification.data?.datasets?.[0] : undefined
  const steam = evidence.steam?.status === 'available' ? evidence.steam.data : undefined
  const classificationBest = classification?.models.reduce((best: JsonRecord | undefined, item: JsonRecord) => !best || item.f1 > best.f1 ? item : best, undefined)
  const steamBest = steam?.methods.reduce((best: JsonRecord | undefined, item: JsonRecord) => !best || item.r2 > best.r2 ? item : best, undefined)
  const rul = evidence['rul-sde-pf']?.status === 'available' ? evidence['rul-sde-pf'].data : undefined
  const loops = evidence['self-evolution-loop']?.status === 'available' ? evidence['self-evolution-loop'].data : undefined
  const failures = figures.filter(figure => ['error', 'incomplete'].includes(figureEvidence(figure, evidence).status))
  const coverage = RESEARCH_TOPICS.map(topic => {
    const declared = topic.points.flatMap(point => point.figure ? [point.figure] : [])
    const available = declared.filter(figure => figureEvidence(figure, evidence).status === 'available').length
    return { key: topic.id, topic, declared, available }
  })
  const classificationOption = useMemo(() => ({
    animation: false,
    tooltip: { trigger: 'axis' }, legend: { top: 0 },
    grid: { left: 55, right: 18, top: 42, bottom: 78 },
    xAxis: xAxisBase({ type: 'category', data: classification?.models.map((m: JsonRecord) => m.name) ?? [], axisLabel: { rotate: 22, fontSize: 10 } }),
    yAxis: yAxisBase({ type: 'value', name: '评分（0–1）', min: 0, max: 1 }),
    series: ['f1', 'auc'].map((metric, index) => ({ name: index ? 'AUC' : 'F1', type: 'bar', data: classification?.models.map((m: JsonRecord) => m[metric]) ?? [], itemStyle: { color: index ? '#477d9e' : '#b24b55' } })),
  }), [classification])
  const regressionOption = useMemo(() => ({
    animation: false,
    tooltip: { trigger: 'axis' },
    grid: { left: 58, right: 20, top: 30, bottom: 78 },
    xAxis: xAxisBase({ type: 'category', data: steam?.methods.map((m: JsonRecord) => m.name) ?? [], axisLabel: { rotate: 22, fontSize: 10 } }),
    yAxis: yAxisBase({ type: 'value', name: 'R²（可为负）', scale: true }),
    series: [{ name: 'R²', type: 'bar', data: steam?.methods.map((m: JsonRecord) => m.r2) ?? [], itemStyle: { color: '#348875' } }],
  }), [steam])

  return (
    <div className="research-overview" data-research-overview>
      <div className="research-overview__intro">
        <p>从原始信号、物理先验到寿命预测与事件闭环，集中展示平台的数据底座、算法对照和可复核证据。</p>
        <div className="research-overview__source"><SourceTag source="offline_experiment" /><span>公开数据与仿真实验分别标注；运行统计来自当前数据库。未提供时间戳的产物不显示更新时间。</span><button type="button" onClick={refresh}>重新核验</button></div>
      </div>
      <dl className="research-metrics" aria-label="研究规模与当前数据状态">
        {[
          ['目录方向', RESEARCH_TOPICS.length, '按研究目录计算'],
          ['研究主题', points.length, '包含证据索引'],
          ['登记数据集', datasets.length || (evidence['dataset-registry']?.status === 'available' ? 0 : '—'), '按资产接口返回计算'],
          ['可用证据', settled ? `${ready} / ${figures.length}` : '核验中', '可用 / 已接图组件'],
          ['横评结果行', models.length || (settled === figures.length ? 0 : '—'), '模型与任务组合，不跨任务排名'],
        ].map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><small>{note}</small></div>)}
      </dl>
      <div className="research-featured-results" aria-label="当前离线实验快照">
        <Link to="/research/results/classification"><span>表格分类 · 最佳 F1</span><strong>{finite(classificationBest?.f1) ? metricText(classificationBest.f1) : '—'}</strong><small>{classification?.name ?? '等待实验数据'} · {classificationBest?.name ?? '模型未就绪'}</small></Link>
        <Link to="/research/results/steam"><span>蒸汽量回归 · 最佳 R²</span><strong>{finite(steamBest?.r2) ? metricText(steamBest.r2) : '—'}</strong><small>{steamBest?.name ?? '模型未就绪'} · 同任务模型内比较</small></Link>
        <Link to="/research/health/rul"><span>寿命预测 · SDE + PF RMSE</span><strong>{finite(rul?.metrics?.sde_pf?.rmse) ? metricText(rul.metrics.sde_pf.rmse) : '—'}</strong><small>XJTU-SY · 归一化剩余寿命误差</small></Link>
      </div>
      {failures.length > 0 && <Alert type="warning" showIcon message={`${failures.length} 个证据源未就绪，其余结果继续展示。研究目录保留明确缺失状态。`} />}
      <section className="research-section" aria-labelledby="research-coverage-title">
        <header><div><span className="research-kicker">01 / COVERAGE</span><h2 id="research-coverage-title">研究覆盖矩阵</h2></div><span>{ready} 个证据源通过数据结构核验</span></header>
        <Table size="small" pagination={false} rowKey="key" dataSource={coverage} scroll={{ x: 790 }} columns={[
          { title: '研究方向 / 核心问题', key: 'topic', width: 230, render: (_, row) => <Link className="research-table-link" to={`/research/${row.topic.id}`}><strong>{row.topic.index} · {row.topic.title}</strong><small>{row.topic.summary}</small></Link> },
          { title: '数据来源', key: 'sources', width: 200, render: (_, row) => <div className="research-cell-lines">{[...new Set(row.declared.map(figure => PROVENANCE[figure].source))].map(source => <span key={source}>{source}</span>)}</div> },
          { title: '方法与证据', key: 'methods', width: 240, render: (_, row) => <div className="research-cell-lines">{row.declared.map(figure => <span key={figure}>{PROVENANCE[figure].method}</span>)}</div> },
          { title: '实际可用', key: 'state', width: 110, render: (_, row) => <span className={row.available === row.declared.length ? 'research-ready-text' : ''}>{row.available} / {row.declared.length}<small className="research-cell-note">{row.declared.some(f => figureEvidence(f, evidence).status === 'loading') ? '核验中' : row.available === row.declared.length ? '全部已接入' : '查看缺失说明'}</small></span> },
        ]} />
      </section>
      <section className="research-section" aria-labelledby="research-assets-title">
        <header><div><span className="research-kicker">02 / DATA ASSETS</span><h2 id="research-assets-title">数据资产与实验基础</h2></div><Link to="/research/signal/assets">查看资产分析 →</Link></header>
        <p className="research-section__note">{datasets.length ? `登记 ${datasets.length} 个数据集：公开数据 ${sources.publicData} 个、仿真数据 ${sources.simulated} 个${sources.unknown ? `、来源未归类 ${sources.unknown} 个` : ''}。下表样本量为登记口径，混合包含信号切片、图像、时序记录等，不相加作为独立实测设备数量。` : '资产接口尚未返回有效登记数据；不推定数据集数量、样本量或来源。'}</p>
        <Table size="small" pagination={false} rowKey="name" scroll={{ x: 900 }} dataSource={datasets} locale={{ emptyText: evidence['dataset-registry']?.message ?? '资产登记核验中' }} columns={[
          { title: '数据集', dataIndex: 'name', width: 130, render: (name, row) => <span><strong>{name}</strong><small className="research-cell-note">{row.task_label ?? '任务未提供'}</small></span> },
          { title: '样本量', dataIndex: 'samples', width: 105, render: n },
          { title: '维度 / 数据类型', key: 'dim', width: 230, render: (_, row) => <span>{row.dim ?? '维度未提供'}<small className="research-cell-note">{row.modality ?? '类型未提供'}</small></span> },
          { title: '数据来源', dataIndex: 'source', width: 215 },
          { title: '用途', dataIndex: 'used_in', width: 220 },
        ]} />
      </section>
      <section className="research-section" aria-labelledby="research-model-title">
        <header><div><span className="research-kicker">03 / MODEL BENCHMARKS</span><h2 id="research-model-title">模型与算法对照</h2></div><Link to="/research/results">全部实验成果 →</Link></header>
        <p className="research-section__note">只展示接口返回的离线指标。分类评分、回归误差、检测速度使用各自口径；不同任务之间不作统一名次。ROC、混淆矩阵、重要性、相关性和退化轨迹在对应研究主题中完整保留。</p>
        <div className="research-overview-charts">
          <section className="research-overview-chart"><h3>{classification?.name ?? '表格分类'} · F1 / AUC</h3><p>同一数据集模型横评 · 数值直接取分类接口</p>{classification ? <ThemedChart option={classificationOption} style={{ height: 280 }} /> : <div className="research-chart-empty">{evidence.classification?.message ?? '正在核验分类实验数据'}</div>}<Link to="/research/results/classification">混淆矩阵、ROC 与特征重要性 →</Link></section>
          <section className="research-overview-chart"><h3>工业蒸汽量预测 · R²</h3><p>保留负值与真实模型差异 · 不构造平滑曲线</p>{steam ? <ThemedChart option={regressionOption} style={{ height: 280 }} /> : <div className="research-chart-empty">{evidence.steam?.message ?? '正在核验回归实验数据'}</div>}<Link to="/research/results/steam">回归预测、误差与传感器相关性 →</Link></section>
        </div>
        <Table size="small" pagination={{ pageSize: 8, showSizeChanger: false }} rowKey="key" scroll={{ x: 850 }} dataSource={models} locale={{ emptyText: '当前没有通过数据结构核验的横评结果' }} columns={[
          { title: '实验任务', dataIndex: 'task', width: 190 },
          { title: '模型', dataIndex: 'model', width: 150 },
          { title: '实际指标', key: 'metrics', width: 400, render: (_, row) => <div className="research-model-metrics">{row.metrics.map(metric => <span key={metric.label}><small>{metric.label}</small><b>{metricText(metric.value)}{metric.unit ?? ''}</b></span>)}</div> },
          { title: '口径', dataIndex: 'source', width: 160 },
        ]} />
      </section>
      <section className="research-section" aria-labelledby="research-engineering-title">
        <header><div><span className="research-kicker">04 / ENGINEERING EVIDENCE</span><h2 id="research-engineering-title">系统机理与工程证据</h2></div><Link to="/research/mechanism">查看双闭环与工厂组织 →</Link></header>
        <div className="research-engineering-grid">
          <div><span className="research-source-label">机制说明</span><h3>事件内闭环 · 阈值外闭环</h3><p>异常与多智能体会诊形成事件，人工确认后执行处置，观察期评估决定恢复或再诊断。阈值建议必须经人工采纳后影响下一轮检测。</p><p className="research-section__note">流程说明解释代码组织关系，不能独立证明诊断准确率上升。</p><Link to="/research/mechanism/loop">查看机制与实际统计 →</Link></div>
          <div><span className="research-source-label">当前数据库统计 · {n(loops?.days)} 天窗口</span><h3>运行记录，不替代实验结论</h3><dl className="research-runtime-metrics"><div><dt>事件</dt><dd>{n(loops?.inner_loop?.total_events)}</dd></div><div><dt>阈值建议</dt><dd>{n(loops?.outer_loop?.suggestions_total)}</dd></div><div><dt>可评估根因样本</dt><dd>{n(loops?.metrics?.total)}</dd></div></dl><p className="research-section__note">{loops?.metrics?.total > 0 ? '准确率与误报/漏报率请结合已注入根因的样本数，在详情页复核。' : '尚无可评估根因样本时不显示准确率；事件数量不代表闭环有效性已经验证。'}</p><p className="research-section__note">数字孪生与产线组织的统计采用仿真数据，分别在主题中标明，不视为实体设备生产实绩。</p></div>
        </div>
      </section>
      <section className="research-section" aria-labelledby="research-evidence-title">
        <header><div><span className="research-kicker">05 / SOURCE STATUS</span><h2 id="research-evidence-title">证据源可用性</h2></div><span>目录声明与实际可用分列</span></header>
        <div className="research-evidence-grid">{RESEARCH_TOPICS.flatMap(topic => topic.points.filter(point => point.figure).map(point => <Link key={`${topic.id}/${point.id}`} to={`/research/${topic.id}/${point.id}`}><strong>{point.title}</strong><EvidenceBadge status={figureEvidence(point.figure!, evidence).status} /><small>{PROVENANCE[point.figure!].source}</small></Link>))}</div>
      </section>
    </div>
  )
}

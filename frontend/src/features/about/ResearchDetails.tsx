import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { Alert, Button } from 'antd'
import { Link } from 'react-router-dom'
import { RESEARCH_FIGURE_LOADERS } from './researchFigureLoaders'
import { PROVENANCE } from './research'
import type { ResearchScene } from './stageTimeline'
import type { EvidenceMap } from './dataContract'
import { figureEvidence } from './dataContract'
import ResearchOverview from './ResearchOverview'
import ResearchLink from './ResearchLink'
import { pointAnchor } from './researchNavigation'
const EvidenceIndex = lazy(() => import('./ResearchEvidenceIndex'))
class Boundary extends Component<{ children: ReactNode; retry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <Alert type="warning" message="图形载入失败，来源信息仍可核对。" action={<Button onClick={this.props.retry}>重试图形</Button>} /> : this.props.children }
}
export default function ResearchDetails({ scene, evidence, refresh, includeRuntime }: {
  scene: ResearchScene; evidence: EvidenceMap; refresh: () => void; includeRuntime: boolean
}) {
  const figure = scene.point?.figure
  const [attempt, setAttempt] = useState(0)
  const Figure = useMemo(() => figure ? lazy(RESEARCH_FIGURE_LOADERS[figure]) : undefined, [figure, attempt])
  const entry = figure ? figureEvidence(figure, evidence) : undefined
  const source = figure ? PROVENANCE[figure] : undefined
  const privateRuntime = figure === 'self-evolution-loop' && !includeRuntime
  return <div className="research-article research-detail" data-research-detail={scene.id}>
    <p className="research-article__lead">{scene.summary}</p>
    {source && <div className="research-provenance"><div><strong>{source.source}</strong><span>{source.evidence}</span></div><p>{source.method}</p><p>{source.kind === 'simulation' ? '仿真预计算产物，不代表实体设备生产实绩。' : source.kind === 'runtime' ? '机制说明与当前数据库统计；无有效样本时不推定准确率。' : source.kind === 'mixed' ? '公开数据、物理变换构造目标域和仿真资产分别采用对应实验协议。' : '公开数据离线实验，不代表当前设备在线诊断结果。'}</p></div>}
    {scene.point && <details className="research-api-source"><summary>核对数据接口</summary><code>{scene.point.api}{figure === 'steam' ? ' + /api/v1/viz/steam' : ''}</code></details>}
    <Boundary key={attempt} retry={() => setAttempt(value => value + 1)}><Suspense fallback={<div role="status" className="research-source-loading">正在载入完整实验…</div>}>
      {privateRuntime ? <div className="research-public-mechanism"><h3>事件与阈值的两条闭环</h3><ol className="research-loop-steps"><li>异常触发会诊</li><li>人工确认与处置</li><li>观察期评估</li><li>复盘阈值建议</li></ol><p>公开入口仅展示机制说明，不读取运行统计。阈值采纳与事件处置仍需正常权限及人工确认。</p><Link to="/login">登录后查看当前数据库统计 →</Link></div>
        : Figure && entry?.status === 'available' ? <div className="research-figure" data-research-figure={figure}><Figure /></div>
        : Figure ? <Alert type={entry?.status === 'error' ? 'warning' : 'info'} message={entry?.status === 'loading' ? '正在核验数据' : '本项证据暂未就绪'} description={entry?.message} action={<Button onClick={refresh}>重新核验</Button>} />
        : scene.topic ? <><ul className="research-detail__links">{scene.topic.points.map(point => <li key={point.id}><ResearchLink anchor={pointAnchor(scene.topic!.id, point.id)}>{point.title} →</ResearchLink><p>{point.summary}</p></li>)}</ul>{scene.point && <EvidenceIndex evidence={evidence} includeRuntime={includeRuntime} />}</>
        : <ResearchOverview evidence={evidence} refresh={refresh} includeRuntime={includeRuntime} />}
    </Suspense></Boundary>
  </div>
}

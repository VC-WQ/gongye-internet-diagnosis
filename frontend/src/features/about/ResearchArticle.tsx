import { lazy, useRef } from 'react'
import { Link } from 'react-router-dom'
import { PageHeading, SourceTag } from '../../components/BusinessUI'
import { RESEARCH_TOPICS, PROVENANCE, type ResearchTopic } from './research'
import { figureEvidence } from './dataContract'
import { useResearchData } from './useResearchData'
import { ResearchDataProvider } from './ResearchDataContext'
import { ResearchNavigationProvider } from './ResearchLink'
import ResearchOverview, { EvidenceBadge } from './ResearchOverview'
import ResearchTree from './ResearchTree'
import LazyResearchFigure, { type ResearchFigureMemory } from './LazyResearchFigure'
import { OVERVIEW_ANCHOR, pointAnchor, topicAnchor } from './researchNavigation'
import { useResearchScroll } from './useResearchScroll'
import { useResearchMotion } from './useResearchMotion'

const EvidenceIndex = lazy(() => import('./ResearchEvidenceIndex'))
const NARRATIVE: Record<string, { question: string; steps: string[]; note: string }> = {
  signal: { question: '证据从哪里来？', steps: ['登记数据资产', '观察时域与频域', '核对特征分布'], note: '先确认来源和划分，再解释模型。信号切片、图像和时序记录采用各自样本口径。' },
  diagnosis: { question: '物理先验如何参与识别？', steps: ['故障频率先验', '分类与抗噪对照', '构造目标域适配'], note: '少样本、噪声与跨域分别回答不同问题；保持同一实验协议内的比较。' },
  health: { question: '如何从退化走向寿命预测？', steps: ['刻画退化状态', '粒子滤波更新', '复核寿命误差'], note: '公开全寿命数据支撑误差评估，泵类数字孪生则单独标明仿真实验。' },
  mechanism: { question: '研究怎样连接运行流程？', steps: ['事件级再诊断', '人工确认与处置', '阈值建议回到检测'], note: '流程说明解释代码组织；运行事件数不能替代离线精度，也不能证明系统已自动变好。' },
  results: { question: '结果能否回到来源复核？', steps: ['核验资产与产物', '按任务读取指标', '比较精度与代价'], note: '分类、回归、检测保留各自量纲；真实零值、负 R² 和缺失结果都原样保留。' },
}

function ArrivalLine() { return <span className="research-arrival-line" aria-hidden="true" /> }
function MethodPath({ topic }: { topic: ResearchTopic }) {
  const narrative = NARRATIVE[topic.id]
  return <aside className="research-method-note" aria-label={`${topic.title}阅读路径`}>
    <strong>{narrative.question}</strong>
    <div className="research-method-path"><svg viewBox="0 0 12 120" aria-hidden="true"><path d="M6 4 V116" /><circle cx="6" cy="4" r="3" /><circle cx="6" cy="60" r="3" /><circle cx="6" cy="116" r="3" /></svg><ol>{narrative.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
    <p>{narrative.note}</p>
  </aside>
}

function PublicMechanism() {
  return <div className="research-public-mechanism">
    <h4>事件与阈值的两条闭环</h4>
    <ol className="research-loop-steps"><li>异常触发会诊</li><li>人工确认与处置</li><li>观察期评估</li><li>恢复或再次诊断</li></ol>
    <p>外闭环根据历史误报与漏报形成阈值建议，经人工采纳后影响下一轮检测。以上是机制说明；公开页面不读取数据库自评、事件或阈值运行统计。</p>
    <Link to="/login" className="research-login-link">登录后查看当前数据库统计 →</Link>
  </div>
}

export default function ResearchArticle({ topicId, pointId }: { topicId?: string; pointId?: string }) {
  const includeRuntime = Boolean(localStorage.getItem('token'))
  const { evidence, refresh } = useResearchData(includeRuntime)
  const article = useRef<HTMLElement>(null)
  const memory = useRef<ResearchFigureMemory>({ heights: new Map(), revealed: new Set() })
  const { active, onAnchor } = useResearchScroll(article, topicId, pointId)
  useResearchMotion(article)

  return <ResearchDataProvider evidence={evidence} refresh={refresh} includeRuntime={includeRuntime}>
    <ResearchNavigationProvider onAnchor={onAnchor}>
      <div data-route-module="research-heading"><PageHeading title="研究中心" meta={<span>数据、算法与工程证据 · 连续研究文章</span>} /></div>
      <div className="research-layout research-story-layout">
        <ResearchTree active={active} />
        <article ref={article} className="research-article research-story" aria-label="工业设备智能诊断研究文章" data-research-article data-route-module="research-article">
          <section className="research-story__overview" aria-labelledby={OVERVIEW_ANCHOR}>
            <h2 id={OVERVIEW_ANCHOR} className="research-story__overview-title" data-research-heading tabIndex={-1}>研究全景<ArrivalLine /></h2>
            <ResearchOverview evidence={evidence} refresh={refresh} includeRuntime={includeRuntime} />
          </section>
          {RESEARCH_TOPICS.map(topic => <section key={topic.id} className={`research-chapter research-chapter--${topic.id}`} data-research-chapter={topic.id}>
            <header className="research-chapter__header"><span className="research-chapter__number" aria-hidden="true">{topic.index}</span><div><h2 id={topicAnchor(topic.id)} data-research-heading tabIndex={-1}>{topic.title}<ArrivalLine /></h2><p>{topic.summary}</p></div></header>
            <div className={`research-chapter__body ${['signal', 'health'].includes(topic.id) ? 'research-chapter__body--sticky' : ''}`}>
              <MethodPath topic={topic} />
              <div className="research-chapter__points">{topic.points.map((point, index) => {
                const entry = point.figure ? figureEvidence(point.figure, evidence) : undefined
                const source = point.figure ? PROVENANCE[point.figure] : undefined
                const privateRuntime = point.figure === 'self-evolution-loop' && !includeRuntime
                return <section className="research-point" key={point.id} data-research-point={`${topic.id}/${point.id}`}>
                  <div className="research-point__heading"><span>{topic.index}.{index + 1}</span><h3 id={pointAnchor(topic.id, point.id)} data-research-heading tabIndex={-1}>{point.title}<ArrivalLine /></h3></div>
                  <p className="research-article__lead">{point.summary}</p>
                  {source && <div className="research-provenance" data-provenance-kind={source.kind}>
                    <div><span className="research-source-label">{source.evidence}</span><strong>{source.source}</strong></div>
                    <div>{privateRuntime ? <span className="research-evidence-status">运行统计需登录</span> : <><EvidenceBadge status={entry?.status} />{source.kind !== 'runtime' && <SourceTag source={entry?.data?._meta?.source ?? (entry?.status === 'available' ? 'offline_experiment' : 'unknown')} />}</>}</div>
                    <p>{source.kind === 'simulation' ? '本研究使用仿真数据预计算结果，不代表实体设备生产实绩。' : source.kind === 'mixed' ? '公开数据、物理变换构造的目标域和仿真资产采用各自协议，不能统一解释为现场采集。' : source.kind === 'runtime' ? '流程图是机制说明；数值来自当前数据库，没有有效根因样本时不推定准确率。' : '公开数据上的离线分析或训练产物，不等同于当前设备的在线诊断结果。'}</p>
                  </div>}
                  <details className="research-api-source"><summary>核对数据接口</summary><code>{point.api}{point.figure === 'steam' ? ' + /api/v1/viz/steam' : ''}</code></details>
                  {privateRuntime ? <PublicMechanism /> : <LazyResearchFigure figure={point.figure ?? 'evidence'} evidence={evidence} onRetry={refresh} memory={memory.current}>
                    {!point.figure && <EvidenceIndex evidence={evidence} includeRuntime={includeRuntime} />}
                  </LazyResearchFigure>}
                </section>
              })}</div>
            </div>
          </section>)}
          <footer className="research-story__end" data-research-end>研究结果以对应数据、实验协议和本次核验状态为准。公开数据、仿真与运行统计保持各自边界。</footer>
        </article>
      </div>
    </ResearchNavigationProvider>
  </ResearchDataProvider>
}

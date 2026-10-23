import { useRef } from 'react'
import { Alert, Button } from 'antd'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import DataAssetRegistry from '../../components/DataAssetRegistry'
import CwruSignal from '../../components/CwruSignal'
import FPCnnCompare from '../../components/FPCnnCompare'
import DomainAdapt from '../../components/DomainAdapt'
import RulSdePf from '../../components/RulSdePf'
import DigitalTwinPhm from '../../components/DigitalTwinPhm'
import SelfEvolutionLoop from '../../components/SelfEvolutionLoop'
import SmartFactory from '../../components/SmartFactory'
import XjtuRul from './figures/XjtuRul'
import ClassificationResearch from './figures/ClassificationResearch'
import SteamResearch from './figures/SteamResearch'
import VisionResearch from './figures/VisionResearch'
import { PageHeading, SourceTag } from '../../components/BusinessUI'
import { useContentTransition } from '../../motion/useContentTransition'
import ResearchTree from './ResearchTree'
import ResearchOverview, { EvidenceBadge } from './ResearchOverview'
import { useResearchData } from './useResearchData'
import { findPoint, findTopic, PROVENANCE, RESEARCH_TOPICS, type ResearchFigure } from './research'
import { figureEvidence, type EvidenceMap } from './dataContract'
import './about.css'

const FIGURES: Record<ResearchFigure, () => JSX.Element> = {
  'dataset-registry': DataAssetRegistry, 'cwru-signal': CwruSignal, 'fpcnn-compare': FPCnnCompare,
  'domain-adapt': DomainAdapt, 'rul-sde-pf': RulSdePf, 'digital-twin-phm': DigitalTwinPhm,
  'self-evolution-loop': SelfEvolutionLoop, 'smart-factory': SmartFactory, 'xjtu-rul': XjtuRul,
  classification: ClassificationResearch, steam: SteamResearch, vision: VisionResearch,
}

function TopicIndex({ topicId, evidence }: { topicId: string; evidence: EvidenceMap }) {
  const topic = findTopic(topicId)
  if (!topic) return null
  return <div className="research-index"><p className="research-index__intro">{topic.summary}</p>{topic.points.map(point => (
    <Link className="research-index__item" key={point.id} to={`/research/${topic.id}/${point.id}`}>
      <div><h2>{point.title}</h2><p>{point.summary}</p>{point.figure && <span className="research-source-label">{PROVENANCE[point.figure].source} · {PROVENANCE[point.figure].evidence}</span>}</div>
      <span className="research-index__trailing">{point.figure ? <EvidenceBadge status={figureEvidence(point.figure, evidence).status} /> : <span>目录索引</span>}<span aria-hidden="true">↗</span></span>
    </Link>
  ))}</div>
}

function EvidenceIndex({ evidence }: { evidence: EvidenceMap }) {
  return <div className="research-index"><p className="research-index__intro">各证据的状态由本次实际接口返回判断；离线实验、仿真与运行统计分别标注。缺失产物保留说明，不伪造结果。</p>{RESEARCH_TOPICS.flatMap(topic => topic.points.filter(point => point.figure).map(point => (
    <Link className="research-index__item" key={`${topic.id}/${point.id}`} to={`/research/${topic.id}/${point.id}`}>
      <div><h2>{topic.index} · {point.title}</h2><p>{point.summary}</p><span className="research-source-label">{PROVENANCE[point.figure!].source}</span></div>
      <span className="research-index__trailing"><EvidenceBadge status={figureEvidence(point.figure!, evidence).status} /><span aria-hidden="true">↗</span></span>
    </Link>
  )))}</div>
}

export default function AboutPage() {
  const params = useParams<{ topicId?: string; pointId?: string }>()
  const location = useLocation()
  const topic = findTopic(params.topicId)
  const point = findPoint(topic, params.pointId)
  const { evidence, refresh } = useResearchData()
  const articleRef = useRef<HTMLElement>(null)
  useContentTransition(`${params.topicId ?? 'home'}/${params.pointId ?? ''}`, articleRef)

  if (params.topicId && !topic) return <Navigate to={`/research${location.search}`} replace />
  if (params.pointId && !point) return <Navigate to={`/research/${params.topicId}${location.search}`} replace />
  const Figure = point?.figure ? FIGURES[point.figure] : undefined
  const entry = point?.figure ? figureEvidence(point.figure, evidence) : undefined
  // Steam's correlation source is independent; never render a chart whose required payload is absent.
  const ready = entry?.status === 'available'
  const waiting = !entry || entry.status === 'loading'
  const source = point?.figure ? PROVENANCE[point.figure] : undefined

  return (
    <>
      <PageHeading title={point?.title ?? topic?.title ?? '研究中心'} meta={
        <nav className="research-breadcrumb" aria-label="研究面包屑">
          {topic ? <><Link to="/research">研究中心</Link><span>/</span>{point ? <><Link to={`/research/${topic.id}`}>{topic.title}</Link><span>/</span><span>{point.title}</span></> : <span>{topic.title}</span>}</> : <span>数据、算法与工程证据</span>}
        </nav>
      } actions={topic ? <Link className="research-back" to={params.pointId ? `/research/${topic.id}` : '/research'}>← 返回{params.pointId ? '研究方向' : '研究总览'}</Link> : undefined} />
      <div className="research-layout">
        <ResearchTree topicId={params.topicId} pointId={params.pointId} />
        <article className="research-article" ref={articleRef} aria-label="研究内容" data-research-article>
          {!topic && <ResearchOverview evidence={evidence} refresh={refresh} />}
          {topic && !point && <TopicIndex topicId={topic.id} evidence={evidence} />}
          {topic && point && <>
            <p className="research-article__lead">{point.summary}</p>
            {source && <div className="research-provenance"><div><span className="research-source-label">{source.evidence}</span><strong>{source.source}</strong></div><div>{source.kind !== 'runtime' && <SourceTag source={entry?.data?._meta?.source ?? (entry?.status === 'available' ? 'offline_experiment' : 'unknown')} />}<EvidenceBadge status={entry?.status} /></div><p>{source.kind === 'simulation' ? '本研究使用仿真数据预计算结果，不代表实体设备生产实绩。' : source.kind === 'mixed' ? '公开数据、构造目标域或仿真资产采用各自协议；请结合图表来源核对，不能统一解释为现场采集。' : source.kind === 'runtime' ? '流程图是机制说明；数值是当前数据库运行统计。没有有效根因样本时不推定准确率。' : '本研究展示公开数据上的离线分析或训练产物；不等同于当前设备的在线诊断结果。'}</p></div>}
            <details className="research-api-source"><summary>核对数据接口</summary><code>{point.api}{point.figure === 'steam' ? ' + /api/v1/viz/steam' : ''}</code></details>
            {!point.figure ? <EvidenceIndex evidence={evidence} /> : ready && Figure ? <div className="research-figure" key={`${topic.id}/${point.id}`} data-research-figure={point.figure}><Figure /></div> : waiting ? <div className="research-source-loading" role="status">正在核验此研究的实际数据…</div> : <Alert type={entry?.status === 'error' ? 'warning' : 'info'} showIcon message="此研究数据尚未就绪" description={entry?.message} action={<Button size="small" onClick={refresh}>重新核验</Button>} />}
          </>}
        </article>
      </div>
    </>
  )
}

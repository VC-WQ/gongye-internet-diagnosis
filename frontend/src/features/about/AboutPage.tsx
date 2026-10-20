import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { Navigate, useParams } from 'react-router-dom'
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
import { PageHeading } from '../../components/BusinessUI'
import ResearchTree from './ResearchTree'
import {
  findPoint,
  findTopic,
  RESEARCH_TOPICS,
  type ResearchFigure,
} from './research'
import './about.css'

const FIGURES: Record<ResearchFigure, () => JSX.Element> = {
  'dataset-registry': DataAssetRegistry,
  'cwru-signal': CwruSignal,
  'fpcnn-compare': FPCnnCompare,
  'domain-adapt': DomainAdapt,
  'rul-sde-pf': RulSdePf,
  'digital-twin-phm': DigitalTwinPhm,
  'self-evolution-loop': SelfEvolutionLoop,
  'smart-factory': SmartFactory,
  'xjtu-rul': XjtuRul,
  classification: ClassificationResearch,
  steam: SteamResearch,
  vision: VisionResearch,
}

function TopicIndex({ topicId }: { topicId: string }) {
  const navigate = useSpatialNavigate()
  const topic = findTopic(topicId)
  if (!topic) return null
  return (
    <div className="research-index">
      <p className="research-index__intro">{topic.summary}</p>
      {topic.points.map((point) => (
        <section className="research-index__item" key={point.id}>
          <div>
            <h2>{point.title}</h2>
            <p>{point.summary}</p>
            <code>{point.api}</code>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/about/research/${topic.id}/${point.id}`)}
          >
            查看交互研究
          </button>
        </section>
      ))}
    </div>
  )
}

function EvidenceIndex() {
  const navigate = useSpatialNavigate()
  return (
    <div className="research-index">
      <p className="research-index__intro">
        以下条目只在后端返回真实实验数据时展示；图表数值直接来自对应接口，前端不做插值或补造。
      </p>
      {RESEARCH_TOPICS.filter((topic) => topic.id !== 'results').map((topic) =>
        topic.points
          .filter((point) => point.figure)
          .map((point) => (
            <section className="research-index__item" key={`${topic.id}-${point.id}`}>
              <div>
                <h2>
                  {topic.index} · {point.title}
                </h2>
                <p>{point.summary}</p>
                <code>{point.api}</code>
              </div>
              <button
                type="button"
                onClick={() =>
                  navigate(`/about/research/${topic.id}/${point.id}`)
                }
              >
                打开证据
              </button>
            </section>
          )),
      )}
    </div>
  )
}

export default function AboutPage() {
  const params = useParams<{ topicId?: string; pointId?: string }>()
  const topic = findTopic(params.topicId)
  const point = findPoint(topic, params.pointId)
  const navigate = useSpatialNavigate()

  if (params.topicId && !topic)
    return <Navigate to="/about" replace />
  if (params.topicId && params.pointId && !point)
    return <Navigate to={`/about/research/${params.topicId}`} replace />

  const isHome = !topic
  const title = point?.title ?? topic?.title ?? '关于'
  const Figure = point?.figure ? FIGURES[point.figure] : undefined

  return (
    <>
      <PageHeading
        title={title}
        meta={
          topic ? (
            <span>
              {topic.index} · {topic.title}
            </span>
          ) : (
            <span>研究目录与可复核的实验证据</span>
          )
        }
        actions={
          topic ? (
            <button
              type="button"
              className="research-back"
              onClick={() =>
                navigate(
                  params.pointId
                    ? `/about/research/${topic.id}`
                    : '/about',
                )
              }
            >
              ← 返回{params.pointId ? '研究方向' : '研究目录'}
            </button>
          ) : undefined
        }
      />
      <div className="research-layout">
        <ResearchTree topicId={params.topicId} pointId={params.pointId} />
        <article className="research-article">
          {isHome && (
            <>
              <p className="research-article__lead">
                这里按研究方向组织平台已有的数据、模型实验与系统机理说明。
                每个交互图表都由真实后端接口提供数据；没有数据的条目不会出现在目录中。
              </p>
              <div className="research-home-grid">
                {RESEARCH_TOPICS.map((item) => (
                  <button
                    type="button"
                    className="research-home-card"
                    key={item.id}
                    onClick={() => navigate(`/about/research/${item.id}`)}
                  >
                    <span>{item.index}</span>
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                  </button>
                ))}
              </div>
            </>
          )}
          {topic && !point && <TopicIndex topicId={topic.id} />}
          {topic && point && (
            <>
              <p className="research-article__lead">{point.summary}</p>
              <div className="research-article__source">
                <span>数据接口</span>
                <code>{point.api}</code>
              </div>
              {point.figure === undefined ? (
                <EvidenceIndex />
              ) : (
                Figure && (
                  <div className="research-figure" key={point.id}>
                    <Figure />
                  </div>
                )
              )}
            </>
          )}
        </article>
      </div>
    </>
  )
}

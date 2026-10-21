import { Navigate, useLocation, useParams } from 'react-router-dom'
import { findPoint, findTopic } from './research'
import ResearchArticle from './ResearchArticle'
import './about.css'

/** Route compatibility only; a topic/point never replaces the article instance. */
export default function AboutPage() {
  const params = useParams<{ topicId?: string; pointId?: string }>()
  const location = useLocation()
  const topic = findTopic(params.topicId)
  if (params.topicId && !topic) return <Navigate to={`/research${location.search}${location.hash}`} replace />
  if (params.pointId && !findPoint(topic, params.pointId)) return <Navigate to={`/research/${params.topicId}${location.search}${location.hash}`} replace />
  return <ResearchArticle topicId={params.topicId} pointId={params.pointId} />
}

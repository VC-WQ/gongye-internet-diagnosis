import { Link } from 'react-router-dom'
import { RESEARCH_TOPICS } from './research'

/** This navigation stays mounted while the research article identity changes. */
export default function ResearchTree({ topicId, pointId }: { topicId?: string; pointId?: string }) {
  return (
    <nav className="research-tree" aria-label="研究目录" data-research-tree>
      <Link to="/research" className={`research-tree__root ${!topicId ? 'is-active' : ''}`} aria-current={!topicId ? 'page' : undefined}>
        研究总览
      </Link>
      {RESEARCH_TOPICS.map(topic => {
        const active = topic.id === topicId
        return (
          <div className="research-tree__topic" key={topic.id}>
            <Link to={`/research/${topic.id}`} className={`research-tree__topic-title ${active && !pointId ? 'is-active' : ''}`} aria-current={active && !pointId ? 'page' : undefined}>
              <span>{topic.index}</span>{topic.title}<small>{topic.points.length}</small>
            </Link>
            <ul className={`research-tree__points ${active ? 'is-expanded' : ''}`}>
              {topic.points.map(point => (
                <li key={point.id}>
                  <Link to={`/research/${topic.id}/${point.id}`} className={point.id === pointId && active ? 'is-active' : ''} aria-current={point.id === pointId && active ? 'page' : undefined}>
                    {point.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

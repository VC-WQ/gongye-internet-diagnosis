import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { RESEARCH_TOPICS } from './research'

export default function ResearchTree({
  topicId,
  pointId,
}: {
  topicId?: string
  pointId?: string
}) {
  const navigate = useSpatialNavigate()
  return (
    <nav className="research-tree" aria-label="研究目录">
      <button
        type="button"
        className={`research-tree__root ${!topicId ? 'is-active' : ''}`}
        aria-current={!topicId ? 'page' : undefined}
        onClick={() => navigate('/about')}
      >
        研究目录
      </button>
      {RESEARCH_TOPICS.map((topic) => {
        const active = topic.id === topicId
        return (
          <div className="research-tree__topic" key={topic.id}>
            <button
              type="button"
              className={`research-tree__topic-title ${active && !pointId ? 'is-active' : ''}`}
              aria-expanded={active}
              aria-current={active && !pointId ? 'page' : undefined}
              onClick={() => navigate(`/about/research/${topic.id}`)}
            >
              <span>{topic.index}</span>
              {topic.title}
            </button>
            {active && (
              <ul className="research-tree__points">
                {topic.points.map((point) => (
                  <li key={point.id}>
                    <button
                      type="button"
                      className={point.id === pointId ? 'is-active' : ''}
                      aria-current={point.id === pointId ? 'page' : undefined}
                      onClick={() =>
                        navigate(`/about/research/${topic.id}/${point.id}`)
                      }
                    >
                      {point.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

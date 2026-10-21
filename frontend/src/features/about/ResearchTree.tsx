import { useRef, useState } from 'react'
import FlipSelection from '../../motion/FlipSelection'
import { RESEARCH_TOPICS } from './research'
import ResearchLink from './ResearchLink'
import { OVERVIEW_ANCHOR, pointAnchor, topicAnchor } from './researchNavigation'

/** Same-document navigation; scroll observations never write browser history. */
export default function ResearchTree({ active, requested }: { active: string; requested?: string }) {
  const [open, setOpen] = useState(false)
  const links = useRef<HTMLDivElement>(null)
  const pending = (id: string) => requested === id ? ' is-pending' : ''
  const current = RESEARCH_TOPICS.flatMap(topic => [
    { id: topicAnchor(topic.id), title: topic.title },
    ...topic.points.map(point => ({ id: pointAnchor(topic.id, point.id), title: point.title })),
  ]).find(item => item.id === active)?.title ?? '研究全景'
  return <nav className={`research-tree ${open ? 'is-open' : ''}`} aria-label="研究目录" data-research-tree data-route-module="research-toc"
    onClick={event => { if ((event.target as HTMLElement).closest('a')) setOpen(false) }}>
    <button className="research-tree__toggle" type="button" aria-expanded={open} aria-controls="research-toc-links" onClick={() => setOpen(value => !value)}>章节目录<span>{current}</span><i aria-hidden="true">{open ? '−' : '+'}</i></button>
    <div ref={links} id="research-toc-links" className="research-tree__links" data-stage-requested={requested}>
      <FlipSelection container={links} identity={requested ?? active} selector={requested ? `[href$="#${requested}"]` : '[aria-current="location"]'} />
      <ResearchLink anchor={OVERVIEW_ANCHOR} className={`research-tree__root ${active === OVERVIEW_ANCHOR ? 'is-active' : ''}${pending(OVERVIEW_ANCHOR)}`} aria-current={active === OVERVIEW_ANCHOR ? 'location' : undefined}>研究全景<span>00</span></ResearchLink>
      {RESEARCH_TOPICS.map(topic => <div className={`research-tree__topic ${active.startsWith(topicAnchor(topic.id)) ? 'is-current' : ''}`} key={topic.id}>
        <ResearchLink anchor={topicAnchor(topic.id)} className={`research-tree__topic-title ${active === topicAnchor(topic.id) ? 'is-active' : ''}${pending(topicAnchor(topic.id))}`} aria-current={active === topicAnchor(topic.id) ? 'location' : undefined}><span>{topic.index}</span>{topic.title}<small>{topic.points.length}</small></ResearchLink>
        <ul className="research-tree__points">{topic.points.map((point, index) => {
          const id = pointAnchor(topic.id, point.id)
          return <li key={point.id}><ResearchLink anchor={id} className={`${id === active ? 'is-active' : ''}${pending(id)}`} aria-current={id === active ? 'location' : undefined}><span>{topic.index}.{index + 1}</span>{point.title}</ResearchLink></li>
        })}</ul>
      </div>)}
    </div>
  </nav>
}

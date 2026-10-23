import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Drawer } from 'antd'
import { PageHeading } from '../../components/BusinessUI'
import FlipText from '../../motion/FlipText'
import FlipValue from '../../motion/FlipValue'
import { useResearchData } from './useResearchData'
import { ResearchDataProvider } from './ResearchDataContext'
import { ResearchNavigationProvider } from './ResearchLink'
import ResearchTree from './ResearchTree'
import ResearchStageScene from './ResearchStageScene'
import ResearchDetails from './ResearchDetails'
import { researchSources, sceneSources } from './researchRequests'
import { sharedLife } from './stagePlots'
import { RESEARCH_SCENES, stageFrame } from './stageTimeline'
import { useStageTimeline } from './useStageTimeline'
import './stage.css'

/** The route instance and data scope survive scene changes; heavy details are released on close. */
export default function ResearchArticle({ topicId, pointId }: { topicId?: string; pointId?: string }) {
  const includeRuntime = Boolean(localStorage.getItem('token'))
  const runway = useRef<HTMLDivElement>(null), stage = useRef<HTMLElement>(null)
  const timeline = useStageTimeline(runway, topicId, pointId)
  const frame = stageFrame(timeline.position)
  const [detailId, setDetailId] = useState<string>()
  const detailScene=RESEARCH_SCENES.find(scene=>scene.id===detailId)
  const wanted=useMemo(()=>[...new Set([
    ...sceneSources(RESEARCH_SCENES[frame.base]),...sceneSources(RESEARCH_SCENES[frame.next]),
    ...(detailScene?(!detailScene.topic||detailScene.id==='research-results-evidence'?researchSources(includeRuntime):sceneSources(detailScene)):[]),
  ])],[frame.base,frame.next,detailScene,includeRuntime])
  const { evidence, refresh, ensure } = useResearchData(includeRuntime,wanted)
  const openDetails = useCallback((id: string) => setDetailId(id), [])
  const current = RESEARCH_SCENES[frame.active]
  const detail = RESEARCH_SCENES.find(scene => scene.id === detailId)
  const activeRef = useRef(current.id)
  useLayoutEffect(() => {
    if (activeRef.current === current.id) return
    activeRef.current = current.id
    if (document.activeElement?.closest('[data-stage-scene]')) stage.current?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true })
  }, [current.id])
  const lifeCompatible = useMemo(() => Boolean(sharedLife(evidence['xjtu-rul']?.status === 'available' ? evidence['xjtu-rul'].data : undefined, evidence['rul-sde-pf']?.status === 'available' ? evidence['rul-sde-pf'].data : undefined)), [evidence['xjtu-rul'],evidence['rul-sde-pf']])
  const lifePair = RESEARCH_SCENES[frame.base].point?.figure === 'xjtu-rul' && RESEARCH_SCENES[frame.next].point?.figure === 'rul-sde-pf' && lifeCompatible
  const layers = lifePair ? [frame.active] : timeline.reducedMotion ? [frame.active] : frame.mix > 0 && frame.next !== frame.base ? [frame.base, frame.next] : [frame.base]
  return <ResearchDataProvider evidence={evidence} refresh={refresh} ensure={ensure} includeRuntime={includeRuntime}>
    <ResearchNavigationProvider onAnchor={(event, id) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) setDetailId(undefined); timeline.onAnchor(event, id) }}>
      <div data-route-module="research-heading"><PageHeading title="研究中心" meta={<span>浏览研究数据、算法与实验结果</span>} /></div>
      <div className="research-layout research-stage-layout" style={{ '--stage-offset': `${timeline.offset}px` } as CSSProperties}>
        <ResearchTree active={timeline.active} requested={timeline.requested} />
        <div ref={runway} className="research-runway" data-research-article data-route-module="research-article" style={{ '--stage-count': RESEARCH_SCENES.length - 1 } as CSSProperties}>
          <section ref={stage} className="research-stage" data-research-stage aria-label="研究叙事舞台" data-stage-active={current.id}>
            <header className="research-stage__bar"><h2 tabIndex={-1} data-stage-heading><FlipText value={current.title} /></h2><span><FlipValue value={`${String(frame.active + 1).padStart(2, '0')} / ${RESEARCH_SCENES.length}`} /></span><button type="button" disabled={frame.active === 0} aria-label="上一个研究场景" onClick={event => timeline.choose(RESEARCH_SCENES[Math.max(0, frame.active - 1)].id, event.detail === 0)}>↑</button><button type="button" disabled={frame.active === RESEARCH_SCENES.length - 1} aria-label="下一个研究场景" onClick={event => timeline.choose(RESEARCH_SCENES[Math.min(RESEARCH_SCENES.length - 1, frame.active + 1)].id, event.detail === 0)}>↓</button></header>
            <div className="research-stage__viewport">
              {layers.map(index => {
                const incoming = index !== frame.base
                const shared = lifeCompatible && ['xjtu-rul', 'rul-sde-pf'].includes(RESEARCH_SCENES[index].point?.figure ?? '')
                const depth = timeline.reducedMotion || lifePair ? 0 : incoming ? (1 - frame.mix) : -frame.mix
                const hidden = index !== frame.active
                return <div key={shared ? 'shared-life' : RESEARCH_SCENES[index].id} className="stage-scene" data-stage-scene={RESEARCH_SCENES[index].id} data-stage-index={index} data-stage-shared={shared} aria-hidden={hidden || undefined}
                  ref={node => {
                    if (!node) return
                    if (hidden && node.contains(document.activeElement)) stage.current?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true })
                    node.inert = hidden
                  }} style={{ '--stage-depth': depth, '--stage-scale': 1 - Math.abs(depth) * .018, '--stage-alpha': 1 - Math.abs(depth), '--stage-clip-start': `${incoming && !lifePair && !timeline.reducedMotion ? (1-frame.mix)*100 : 0}%`, '--stage-clip-end': `${!incoming && !lifePair && !timeline.reducedMotion ? frame.mix*100 : 0}%` } as CSSProperties}>
                  <ResearchStageScene scene={RESEARCH_SCENES[index]} evidence={evidence} includeRuntime={includeRuntime} onDetails={openDetails} onRetry={refresh} lifeReveal={lifePair ? timeline.reducedMotion ? (current.point?.figure === 'rul-sde-pf' ? 1 : 0) : frame.mix : undefined} />
                </div>
              })}
            </div>
            <footer className="research-stage__progress"><span>滚动浏览 · 可从目录跳转</span><div role="progressbar" aria-label="研究叙事进度" aria-valuemin={1} aria-valuemax={RESEARCH_SCENES.length} aria-valuenow={frame.active + 1}><i style={{ transform: `scaleX(${(timeline.position + 1) / RESEARCH_SCENES.length})` }} /></div></footer>
          </section>
        </div>
      </div>

      <Drawer title={detail?.title ?? '完整研究证据'} open={Boolean(detail)} onClose={() => setDetailId(undefined)} afterOpenChange={open => {
        // Late data can replace the scene (for example, the shared life plot).
        // Restore to its current trigger rather than a detached DOM reference.
        if (!open) (stage.current?.querySelector<HTMLElement>('[data-stage-scene]:not([aria-hidden="true"]) .stage-scene__source button') ?? stage.current?.querySelector<HTMLElement>('[data-stage-heading]'))?.focus({ preventScroll: true })
      }} width="min(1180px, 100vw)" destroyOnClose rootClassName="research-detail-drawer">
        {detail && <ResearchDetails key={detail.id} scene={detail} evidence={evidence} refresh={refresh} includeRuntime={includeRuntime} />}
      </Drawer>
    </ResearchNavigationProvider>
  </ResearchDataProvider>
}

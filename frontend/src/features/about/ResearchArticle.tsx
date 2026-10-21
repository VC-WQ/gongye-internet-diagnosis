import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Drawer } from 'antd'
import { PageHeading } from '../../components/BusinessUI'
import { useResearchData } from './useResearchData'
import { ResearchDataProvider } from './ResearchDataContext'
import { ResearchNavigationProvider } from './ResearchLink'
import ResearchTree from './ResearchTree'
import ResearchStageScene from './ResearchStageScene'
import ResearchDetails from './ResearchDetails'
import { RESEARCH_SCENES, stageFrame } from './stageTimeline'
import { useStageTimeline } from './useStageTimeline'
import './stage.css'

/** The route instance and data scope survive scene changes; heavy details are released on close. */
export default function ResearchArticle({ topicId, pointId }: { topicId?: string; pointId?: string }) {
  const includeRuntime = Boolean(localStorage.getItem('token'))
  const { evidence, refresh } = useResearchData(includeRuntime)
  const runway = useRef<HTMLDivElement>(null), stage = useRef<HTMLElement>(null)
  const timeline = useStageTimeline(runway, topicId, pointId)
  const frame = stageFrame(timeline.position)
  const [detailId, setDetailId] = useState<string>()
  const openDetails = useCallback((id: string) => setDetailId(id), [])
  const current = RESEARCH_SCENES[frame.active]
  const detail = RESEARCH_SCENES.find(scene => scene.id === detailId)
  const activeRef = useRef(current.id)
  useLayoutEffect(() => {
    if (activeRef.current === current.id) return
    activeRef.current = current.id
    if (document.activeElement?.closest('[data-stage-scene]')) stage.current?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true })
  }, [current.id])
  const layers = timeline.reducedMotion ? [frame.active] : frame.mix > 0 && frame.next !== frame.base ? [frame.base, frame.next] : [frame.base]
  return <ResearchDataProvider evidence={evidence} refresh={refresh} includeRuntime={includeRuntime}>
    <ResearchNavigationProvider onAnchor={(event, id) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) setDetailId(undefined); timeline.onAnchor(event, id) }}>
      <div data-route-module="research-heading"><PageHeading title="研究中心" meta={<span>数据、算法与工程证据 · 滚动推进研究舞台</span>} /></div>
      <div className="research-layout research-stage-layout" style={{ '--stage-offset': `${timeline.offset}px` } as CSSProperties}>
        <ResearchTree active={timeline.active} requested={timeline.requested} />
        <div ref={runway} className="research-runway" data-research-article data-route-module="research-article" style={{ '--stage-count': RESEARCH_SCENES.length - 1 } as CSSProperties}>
          <section ref={stage} className="research-stage" data-research-stage aria-label="研究叙事舞台" data-stage-active={current.id}>
            <header className="research-stage__bar"><h2 tabIndex={-1} data-stage-heading>{current.title}</h2><span>{String(frame.active + 1).padStart(2, '0')} / {RESEARCH_SCENES.length}</span><button type="button" disabled={frame.active === 0} aria-label="上一个研究场景" onClick={event => timeline.choose(RESEARCH_SCENES[Math.max(0, frame.active - 1)].id, event.detail === 0)}>↑</button><button type="button" disabled={frame.active === RESEARCH_SCENES.length - 1} aria-label="下一个研究场景" onClick={event => timeline.choose(RESEARCH_SCENES[Math.min(RESEARCH_SCENES.length - 1, frame.active + 1)].id, event.detail === 0)}>↓</button></header>
            <div className="research-stage__viewport">
              <div className="stage-evidence-chain" aria-hidden="true" style={{ transform: `translateY(${-timeline.position * 6}px)` }}><span>信号</span><i /><span>诊断</span><i /><span>寿命</span><i /><span>闭环</span><i /><span>证据</span></div>
              {layers.map(index => {
                const incoming = index !== frame.base
                const y = timeline.reducedMotion ? 0 : incoming ? (1 - frame.mix) * 106 : -frame.mix * 106
                const depth = timeline.reducedMotion ? 0 : incoming ? (1 - frame.mix) : -frame.mix
                const hidden = index !== frame.active
                return <div key={RESEARCH_SCENES[index].id} className="stage-scene" data-stage-scene={RESEARCH_SCENES[index].id} aria-hidden={hidden || undefined}
                  ref={node => {
                    if (!node) return
                    if (hidden && node.contains(document.activeElement)) stage.current?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true })
                    node.inert = hidden
                  }} style={{ transform: `translateY(${y}%)`, '--stage-depth': depth, '--stage-scale': 1 - Math.abs(depth) * .035 } as CSSProperties}>
                  <ResearchStageScene scene={RESEARCH_SCENES[index]} evidence={evidence} includeRuntime={includeRuntime} onDetails={openDetails} onRetry={refresh} />
                </div>
              })}
            </div>
            <footer className="research-stage__progress"><span>滚动推进 · 停留阅读 · 可反向回看</span><div role="progressbar" aria-label="研究叙事进度" aria-valuemin={1} aria-valuemax={RESEARCH_SCENES.length} aria-valuenow={frame.active + 1}><i style={{ transform: `scaleX(${(timeline.position + 1) / RESEARCH_SCENES.length})` }} /></div></footer>
          </section>
        </div>
      </div>
      <footer className="research-stage-end" data-research-end><span>研究舞台到此结束</span><h2>每个结果，都应能回到证据。</h2><p>公开数据、仿真实验与运行统计各自采用对应协议。完整实验保留坐标、单位、模型对照和来源；缺失产物不生成替代数值。</p><button type="button" onClick={() => timeline.choose('research-results-evidence')}>核对全部研究证据 →</button></footer>
      <Drawer title={detail?.title ?? '完整研究证据'} open={Boolean(detail)} onClose={() => setDetailId(undefined)} width="min(1180px, 100vw)" destroyOnClose rootClassName="research-detail-drawer">
        {detail && <ResearchDetails key={detail.id} scene={detail} evidence={evidence} refresh={refresh} includeRuntime={includeRuntime} />}
      </Drawer>
    </ResearchNavigationProvider>
  </ResearchDataProvider>
}

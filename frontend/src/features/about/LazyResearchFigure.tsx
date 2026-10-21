import { Component, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Button } from 'antd'
import { useUiPreferences } from '../../services/uiPrefs'
import { figureEvidence, type EvidenceMap } from './dataContract'
import { estimateFigureHeight } from './researchNavigation'
import type { ResearchFigure } from './research'
import { EASE_CSS, MOTION } from '../../motion/tokens'

const LOADERS = {
  'dataset-registry': () => import('../../components/DataAssetRegistry'),
  'cwru-signal': () => import('../../components/CwruSignal'),
  'fpcnn-compare': () => import('../../components/FPCnnCompare'),
  'domain-adapt': () => import('../../components/DomainAdapt'),
  'rul-sde-pf': () => import('../../components/RulSdePf'),
  'xjtu-rul': () => import('./figures/XjtuRul'),
  'digital-twin-phm': () => import('../../components/DigitalTwinPhm'),
  'self-evolution-loop': () => import('../../components/SelfEvolutionLoop'),
  'smart-factory': () => import('../../components/SmartFactory'),
  classification: () => import('./figures/ClassificationResearch'),
  steam: () => import('./figures/SteamResearch'),
  vision: () => import('./figures/VisionResearch'),
}

class FigureBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <Alert type="warning" showIcon message="图形未能载入，其余研究内容仍可阅读。"
      action={<Button onClick={this.props.onRetry}>重试图形</Button>} /> : this.props.children
  }
}

type ResearchBlock = ResearchFigure | 'evidence'
export interface ResearchFigureMemory {
  heights: Map<string, number>
  revealed: Set<ResearchBlock>
}

export default function LazyResearchFigure({ figure, evidence, onRetry, memory, children }: {
  figure: ResearchBlock; evidence: EvidenceMap; onRetry: () => void; memory: ResearchFigureMemory; children?: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [bucket, setBucket] = useState('initial')
  const compact = typeof matchMedia === 'function' && matchMedia('(max-width: 1100px)').matches
  const estimate = (small: boolean) => figure === 'evidence' ? small ? 3400 : 2200 : estimateFigureHeight(figure, small)
  const [height, setHeight] = useState(() => estimate(compact))
  const retain = useRef(false)
  const release = useRef<ReturnType<typeof setTimeout>>()
  const { reducedMotion } = useUiPreferences()
  const Figure = useMemo(() => figure === 'evidence' ? undefined : lazy(LOADERS[figure]), [figure, attempt])
  const entry = figure === 'evidence' ? { status: 'available' as const, message: undefined } : figureEvidence(figure, evidence)

  useLayoutEffect(() => {
    const node = host.current
    if (!node) return
    let width = -1
    const measureWidth = () => {
      const next = Math.round(node.getBoundingClientRect().width / 80) * 80
      if (next === width) return
      width = next
      const small = matchMedia('(max-width: 1100px)').matches
      const key = `${figure}:${small ? 'compact' : 'wide'}:${next}`
      setBucket(key)
      setHeight(memory.heights.get(key) ?? estimate(small))
    }
    measureWidth()
    const observer = new ResizeObserver(measureWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [figure, memory])

  useEffect(() => {
    const node = host.current
    if (!node) return
    const stopRelease = () => clearTimeout(release.current)
    const scheduleRelease = () => {
      stopRelease()
      if (retain.current || node.contains(document.activeElement)) return
      release.current = setTimeout(() => {
        if (!retain.current && !node.contains(document.activeElement)) setMounted(false)
      }, 1200)
    }
    // The inner window prewarms code and mounts charts. The larger window keeps
    // them alive through a small scroll reversal instead of churning instances.
    const prewarm = new IntersectionObserver(([item]) => {
      if (item.isIntersecting) { stopRelease(); setMounted(true) }
    }, { rootMargin: '750px 0px', threshold: 0 })
    const retention = new IntersectionObserver(([item]) => {
      retain.current = item.isIntersecting
      if (item.isIntersecting) stopRelease()
      else scheduleRelease()
    }, { rootMargin: '1600px 0px', threshold: 0 })
    prewarm.observe(node)
    retention.observe(node)
    node.addEventListener('focusin', stopRelease)
    node.addEventListener('focusout', scheduleRelease)
    return () => {
      prewarm.disconnect(); retention.disconnect(); stopRelease()
      node.removeEventListener('focusin', stopRelease)
      node.removeEventListener('focusout', scheduleRelease)
    }
  }, [])

  useLayoutEffect(() => {
    if (!content) return
    const measure = () => {
      const next = Math.ceil(content.getBoundingClientRect().height)
      if (next <= 0) return
      memory.heights.set(bucket, next)
      setHeight(value => Math.abs(value - next) > 1 ? next : value)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [content, bucket, memory])

  useEffect(() => {
    if (!content || entry.status !== 'available' || memory.revealed.has(figure)) return
    const observer = new IntersectionObserver(([item]) => {
      if (!item.isIntersecting) return
      memory.revealed.add(figure)
      observer.disconnect()
      if (!reducedMotion) {
        const animation = content.animate([
          { clipPath: 'inset(0 100% 0 0)', opacity: .7 },
          { clipPath: 'inset(0 0% 0 0)', opacity: 1 },
        ], { duration: MOTION.researchReveal.duration, easing: EASE_CSS.outward })
        activeAnimation = animation
        void animation.finished.catch(() => {})
      }
    }, { threshold: 0, rootMargin: '0px 0px -7% 0px' })
    let activeAnimation: Animation | undefined
    observer.observe(content)
    return () => { observer.disconnect(); activeAnimation?.cancel() }
  }, [content, figure, memory, reducedMotion, entry.status])

  const placeholder = <div className="research-figure-placeholder" style={{ minHeight: height }} aria-hidden="true">
    <span>图表区域 · {mounted ? '载入图形' : '阅读至此处载入'}</span><i />
  </div>
  return <div ref={host} className="research-lazy-figure" data-research-lazy={figure} data-figure-mounted={mounted || undefined}
    data-figure-layout-pending={mounted && entry.status === 'available' && !content || undefined}
    style={{ minHeight: height }}>
    {!mounted ? placeholder : entry.status === 'available' ? <FigureBoundary key={attempt} onRetry={() => setAttempt(value => value + 1)}>
      <Suspense fallback={placeholder}><div ref={setContent} className="research-figure" data-research-figure={figure === 'evidence' ? undefined : figure} data-research-evidence-index={figure === 'evidence' || undefined}>{Figure ? <Figure /> : children}</div></Suspense>
    </FigureBoundary> : entry.status === 'loading' ? <div className="research-source-loading" role="status">正在核验此研究的实际数据…</div>
      : <div ref={setContent}><Alert type={entry.status === 'error' ? 'warning' : 'info'} showIcon message="此研究数据尚未就绪" description={entry.message}
        action={<Button size="small" onClick={onRetry}>重新核验</Button>} /></div>}
  </div>
}

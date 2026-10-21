import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUiPreferences } from '../../services/uiPrefs'
import { researchTarget, ResearchScrollIntent, SCROLL_KEYS } from './researchNavigation'
import type { ResearchAnchorHandler } from './ResearchLink'
import { RESEARCH_SCENES, clamp, sceneIndex, stageFrame, timelinePosition } from './stageTimeline'

/** One owner for scroll, TOC, route restoration and interruption. Idle has no RAF. */
export function useStageTimeline(root: RefObject<HTMLDivElement>, topicId?: string, pointId?: string) {
  const location = useLocation(), navigate = useNavigate()
  const { reducedMotion } = useUiPreferences()
  const reducedRef = useRef(reducedMotion); reducedRef.current = reducedMotion
  const [position, setPosition] = useState(0)
  const [requested, setRequested] = useState<string>()
  const [offset, setOffset] = useState(96)
  const positionRef = useRef(0), frame = useRef(0), sampleFrame = useRef(0)
  const intent = useRef(new ResearchScrollIntent())
  const syncing = useRef<string>(), userScroll = useRef(false), animating = useRef(false)
  const ownedScrollUntil = useRef(0)
  const syncTimer = useRef<ReturnType<typeof setTimeout>>()
  const lastLocation = useRef(''), focusOnArrival = useRef(false)
  const route = useRef(location); route.current = location
  const offsetRef = useRef(offset); offsetRef.current = offset
  const publish = useCallback((value: number) => {
    const focused = document.activeElement as HTMLElement | null
    const focusedScene = focused?.closest<HTMLElement>('[data-stage-scene]')
    const nextId = RESEARCH_SCENES[stageFrame(value).active].id
    if (focusedScene && root.current?.contains(focusedScene) && focusedScene.dataset.stageScene !== nextId) {
      root.current.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true })
    }
    positionRef.current = value
    setPosition(value)
    if (root.current) root.current.dataset.stagePosition = value.toFixed(4)
  }, [root])
  const geometry = useCallback(() => {
    const node = root.current
    if (!node) return { start: 0, travel: 1 }
    const rect = node.getBoundingClientRect()
    const stage = node.querySelector<HTMLElement>('[data-research-stage]')
    return { start: Math.max(0, rect.top + scrollY - offsetRef.current), travel: Math.max(1, node.offsetHeight - (stage?.offsetHeight ?? 1)) }
  }, [root])
  const sample = useCallback(() => {
    const { start, travel } = geometry()
    const value = timelinePosition(scrollY, start, travel)
    publish(value)
    return value
  }, [geometry, publish])
  const cancel = useCallback(() => {
    intent.current.cancel(); cancelAnimationFrame(frame.current); animating.current = false
    setRequested(undefined)
    if (root.current) root.current.dataset.stageState = 'interrupted'
  }, [root])
  const move = useCallback((id: string, animate: boolean) => {
    cancel()
    const index = sceneIndex(id), epoch = intent.current.begin()
    const { start, travel } = geometry()
    const target = start + index / (RESEARCH_SCENES.length - 1) * travel
    const from = scrollY, started = performance.now()
    const duration = animate && !reducedRef.current ? clamp(Math.abs(target - from) * .12, 280, 850) : 0
    animating.current = true; userScroll.current = false; setRequested(id)
    if (root.current) root.current.dataset.stageState = 'seeking'
    const tick = (now: number) => {
      if (!intent.current.current(epoch)) return
      const t = duration && !reducedRef.current ? Math.min(1, (now - started) / duration) : 1
      const ease = 1 - Math.pow(1 - t, 3)
      ownedScrollUntil.current = performance.now() + 120
      window.scrollTo({ top: from + (target - from) * ease, behavior: 'instant' as ScrollBehavior })
      sample()
      if (t < 1) frame.current = requestAnimationFrame(tick)
      else {
        animating.current = false; setRequested(undefined)
        if (root.current) root.current.dataset.stageState = Math.abs(scrollY - target) <= 2 ? 'settled' : 'unreachable'
        if (focusOnArrival.current) {
          root.current?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true })
          focusOnArrival.current = false
        }
      }
    }
    frame.current = requestAnimationFrame(tick)
  }, [cancel, geometry, root, sample])

  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>('.workspace-header')
    let initialized = false, lastSize = ''
    const update = () => {
      const size = `${innerWidth}:${innerHeight}:${header?.getBoundingClientRect().height ?? 72}`
      if (lastSize === size) return
      lastSize = size
      const oldGeometry = geometry()
      const inside = scrollY >= oldGeometry.start && scrollY <= oldGeometry.start + oldGeometry.travel
      const previousPosition = positionRef.current
      const next = Math.ceil(header?.getBoundingClientRect().height ?? 72) + (innerWidth <= 900 ? 60 : 18)
      const node = root.current
      offsetRef.current = next; setOffset(next)
      node?.parentElement?.style.setProperty('--stage-offset', `${next}px`)
      node?.style.setProperty('--stage-step', `${Math.max(420, innerHeight * .82)}px`)
      // Preserve timeline position through rotation/resizing, never restart a completed route intent.
      if (initialized && node) {
        cancel()
        if (inside) {
          const nextGeometry = geometry()
          ownedScrollUntil.current = performance.now() + 120
          window.scrollTo({ top: nextGeometry.start + previousPosition / (RESEARCH_SCENES.length - 1) * nextGeometry.travel, behavior: 'instant' as ScrollBehavior })
        }
        sample()
      }
      initialized = true
    }
    update()
    const observer = new ResizeObserver(update)
    if (header) observer.observe(header)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [root, sample, geometry, cancel])

  useLayoutEffect(() => {
    const signature = `${location.key}:${location.pathname}${location.search}${location.hash}`
    if (signature === lastLocation.current) return
    lastLocation.current = signature
    const url = `${location.pathname}${location.search}${location.hash}`
    if (syncing.current === url) { syncing.current = undefined; return }
    move(researchTarget(location.hash, topicId, pointId), Boolean(location.state?.researchStageClick))
    return () => { lastLocation.current = '' }
  }, [location.key, location.pathname, location.search, location.hash, location.state, topicId, pointId, move])

  useLayoutEffect(() => {
    const write = () => {
      if (!userScroll.current || animating.current) return
      const id = RESEARCH_SCENES[stageFrame(positionRef.current).active].id
      const current = route.current
      const hash = `#${id}`
      if (current.hash === hash) return
      const url = `${current.pathname}${current.search}${hash}`
      syncing.current = url
      navigate(url, { replace: true, state: { researchStageProgress: positionRef.current } })
    }
    const scroll = () => {
      // Scrollbar dragging and assistive scrolling may emit no wheel/touch event.
      // Exclude our own route/resize writes, then observe them as manual progress.
      if (!animating.current && performance.now() > ownedScrollUntil.current) userScroll.current = true
      if (!sampleFrame.current) sampleFrame.current = requestAnimationFrame(() => { sampleFrame.current = 0; sample() })
      clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(write, 180)
    }
    const interrupt = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.ant-drawer, .pico-dock, input, textarea, select, [contenteditable=true]')) return
      if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) return
      cancel(); userScroll.current = true
    }
    window.addEventListener('scroll', scroll, { passive: true })
    window.addEventListener('wheel', interrupt, { passive: true })
    window.addEventListener('touchstart', interrupt, { passive: true })
    const scrollbar = (event: PointerEvent) => { if (event.clientX >= document.documentElement.clientWidth) interrupt(event) }
    window.addEventListener('pointerdown', scrollbar, { passive: true })
    window.addEventListener('keydown', interrupt)
    return () => {
      window.removeEventListener('scroll', scroll); window.removeEventListener('wheel', interrupt)
      window.removeEventListener('touchstart', interrupt); window.removeEventListener('keydown', interrupt)
      window.removeEventListener('pointerdown', scrollbar)
      cancelAnimationFrame(sampleFrame.current); clearTimeout(syncTimer.current)
    }
  }, [cancel, navigate, sample])
  useLayoutEffect(() => () => { intent.current.cancel(); cancelAnimationFrame(frame.current) }, [])

  const choose = useCallback((id: string, keyboard = false) => {
    if (!RESEARCH_SCENES.some(scene => scene.id === id)) return
    focusOnArrival.current = keyboard
    // Navigate through React Router; hash is a scene identity, never a DOM anchor jump.
    const current = route.current
    const url = `/research${current.search}#${id}`
    if (`${current.pathname}${current.search}${current.hash}` === url) move(id, true)
    else { cancel(); setRequested(id); navigate(url, { state: { researchStageClick: true } }) }
  }, [cancel, move, navigate])
  const onAnchor: ResearchAnchorHandler = useCallback((event, id) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault(); choose(id, event.detail === 0)
  }, [choose])
  return { position, active: RESEARCH_SCENES[stageFrame(position).active].id, requested, onAnchor, choose, reducedMotion, offset }
}

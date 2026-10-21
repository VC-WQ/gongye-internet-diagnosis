import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useUiPreferences } from '../../services/uiPrefs'
import { activeResearchHeading, OVERVIEW_ANCHOR, RESEARCH_ANCHORS, ResearchScrollIntent, researchTarget, SCROLL_KEYS } from './researchNavigation'
import type { ResearchAnchorHandler } from './ResearchLink'
import { EASE_CSS, MOTION } from '../../motion/tokens'

// Deliberately bounded work: no perpetual per-frame scan of the article.
const TITLE_ACK_MS = MOTION.researchTitle.duration
const SCROLL_SETTLE_MS = 180
const SCROLL_LIMIT_MS = 4200
const storageKey = (key: string) => `research:scroll:${key}`
function savedPosition(key: string): number | undefined {
  try {
    const value = sessionStorage.getItem(storageKey(key))
    const y = value === null ? NaN : Number(value)
    return Number.isFinite(y) && y >= 0 ? y : undefined
  } catch { return undefined }
}

export function useResearchScroll(root: RefObject<HTMLElement>, topicId?: string, pointId?: string) {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const { reducedMotion } = useUiPreferences()
  const [active, setActive] = useState(OVERVIEW_ANCHOR)
  const [offset, setOffset] = useState(96)
  const intent = useRef(new ResearchScrollIntent())
  const frame = useRef(0)
  const headingAnimation = useRef<Animation>()
  const emphasisTimer = useRef<ReturnType<typeof setTimeout>>()
  const focusTarget = useRef<string>()
  const position = useRef(new Map<string, number>())
  const lastKey = useRef<string>()
  const target = useRef<string>()

  const cancel = useCallback(() => {
    intent.current.cancel()
    cancelAnimationFrame(frame.current)
    target.current = undefined
    if (root.current) root.current.dataset.researchScrollState = 'cancelled'
    headingAnimation.current?.cancel()
    clearTimeout(emphasisTimer.current)
    root.current?.querySelectorAll('[data-research-arrived]').forEach(item => item.removeAttribute('data-research-arrived'))
  }, [root])

  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>('.workspace-header')
    if (!header) return
    const measure = () => {
      const headerHeight = Math.ceil(header.getBoundingClientRect().height)
      const toggle = document.querySelector<HTMLElement>('.research-tree__toggle')
      const tocHeight = matchMedia('(max-width: 900px)').matches ? toggle?.getBoundingClientRect().height ?? 0 : 0
      const next = headerHeight + tocHeight + 24
      setOffset(value => value === next ? value : next)
      root.current?.parentElement?.style.setProperty('--research-anchor-offset', `${next}px`)
      root.current?.parentElement?.style.setProperty('--research-header-height', `${headerHeight}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    const toggle = document.querySelector<HTMLElement>('.research-tree__toggle')
    if (toggle) observer.observe(toggle)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [root])

  const emphasize = useCallback((node: HTMLElement, id: string, epoch: number) => {
    if (!intent.current.current(epoch)) return
    headingAnimation.current?.cancel()
    clearTimeout(emphasisTimer.current)
    root.current?.querySelectorAll('[data-research-arrived]').forEach(item => item.removeAttribute('data-research-arrived'))
    node.dataset.researchArrived = 'true'
    const line = node.querySelector<HTMLElement>('.research-arrival-line')
    if (line && !reducedMotion) headingAnimation.current = line.animate([
      { transform: 'scaleX(0)', opacity: 1 },
      { transform: 'scaleX(1)', opacity: 1, offset: .7 },
      { transform: 'scaleX(1)', opacity: 0 },
    ], { duration: TITLE_ACK_MS, easing: EASE_CSS.outward })
    emphasisTimer.current = setTimeout(() => { delete node.dataset.researchArrived }, reducedMotion ? 700 : TITLE_ACK_MS)
    if (focusTarget.current === id) { node.focus({ preventScroll: true }); focusTarget.current = undefined }
    setActive(id)
  }, [root, reducedMotion])

  const locate = useCallback((id: string, restoreY?: number) => {
    cancel()
    const node = document.getElementById(id)
    if (!node || !root.current?.contains(node)) return
    const epoch = intent.current.begin()
    target.current = id
    if (root.current) root.current.dataset.researchScrollState = 'locating'
    const desired = () => Math.max(0, Math.min(
      restoreY ?? (id === OVERVIEW_ANCHOR ? 0 : node.getBoundingClientRect().top + window.scrollY - offset),
      Math.max(0, document.documentElement.scrollHeight - innerHeight),
    ))
    window.scrollTo({ top: desired(), behavior: reducedMotion || restoreY !== undefined ? 'auto' : 'smooth' })
    const started = performance.now()
    let previousY = window.scrollY, previousTarget = desired(), stableSince = started
    const settle = (now: number) => {
      if (!intent.current.current(epoch)) return
      const y = window.scrollY, aim = desired()
      const pendingLayout = Boolean(root.current?.querySelector('[data-figure-layout-pending]'))
      if (pendingLayout || Math.abs(y - previousY) > .5 || Math.abs(aim - previousTarget) > .5) stableSince = now
      previousY = y; previousTarget = aim
      if (!pendingLayout && now - stableSince >= SCROLL_SETTLE_MS && now - started >= 500) {
        if (Math.abs(y - aim) > 2) {
          // Only finish an explicit, still-owned intent after async layout settled.
          // User gestures cancel the epoch before this can move the viewport.
          window.scrollTo({ top: aim, behavior: 'auto' })
          stableSince = now
        } else {
          target.current = undefined
          if (root.current) root.current.dataset.researchScrollState = 'settled'
          if (restoreY === undefined) emphasize(node, id, epoch)
          return
        }
      }
      if (now - started < SCROLL_LIMIT_MS) frame.current = requestAnimationFrame(settle)
      else { target.current = undefined; if (root.current) root.current.dataset.researchScrollState = 'timed-out' }
    }
    frame.current = requestAnimationFrame(settle)
  }, [cancel, root, offset, reducedMotion, emphasize])

  useLayoutEffect(() => {
    const article = root.current
    if (!article) return
    const headings = [...article.querySelectorAll<HTMLElement>('[data-research-heading]')]
    const update = () => {
      if (target.current) return
      const atEnd = window.scrollY > 0 && window.scrollY + innerHeight >= document.documentElement.scrollHeight - 8
      const next = activeResearchHeading(headings.map(node => ({ id: node.id, top: node.getBoundingClientRect().top })), offset, atEnd)
      setActive(value => value === next ? value : next)
    }
    const observer = new IntersectionObserver(update, { rootMargin: `-${offset}px 0px -60% 0px`, threshold: [0, 1] })
    headings.forEach(node => observer.observe(node))
    const end = article.querySelector('[data-research-end]')
    if (end) observer.observe(end)
    const interrupt = () => {
      const wasScrolling = Boolean(target.current)
      cancel()
      focusTarget.current = undefined
      if (wasScrolling) window.scrollTo({ top: window.scrollY, behavior: 'auto' })
      update()
    }
    const keyboard = (event: KeyboardEvent) => { if (SCROLL_KEYS.has(event.key)) interrupt() }
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const persist = () => {
      try { sessionStorage.setItem(storageKey(location.key), String(position.current.get(location.key) ?? window.scrollY)) } catch { /* memory-only fallback */ }
    }
    const save = () => {
      position.current.set(location.key, window.scrollY)
      clearTimeout(saveTimer)
      saveTimer = setTimeout(persist, 120)
    }
    window.addEventListener('wheel', interrupt, { passive: true })
    window.addEventListener('touchstart', interrupt, { passive: true })
    window.addEventListener('pointerdown', interrupt, { passive: true })
    window.addEventListener('keydown', keyboard)
    window.addEventListener('scroll', save, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('wheel', interrupt)
      window.removeEventListener('touchstart', interrupt)
      window.removeEventListener('pointerdown', interrupt)
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('scroll', save)
      position.current.set(location.key, window.scrollY)
      clearTimeout(saveTimer)
      persist()
    }
  }, [root, offset, location.key, cancel])

  useLayoutEffect(() => {
    const id = researchTarget(location.hash, topicId, pointId)
    const restore = navigationType === 'POP' && !location.hash && !topicId
      ? position.current.get(location.key) ?? savedPosition(location.key) : undefined
    // Offset may be measured once after mount; it must not manufacture a new history entry.
    const signature = `${location.key}:${location.hash}:${topicId ?? ''}:${pointId ?? ''}`
    // Geometry/RM updates may refine a still-owned task, never revive a gesture-
    // cancelled or already completed navigation to an old hash.
    if (lastKey.current === signature && !target.current) return
    lastKey.current = signature
    locate(id, restore && restore > 0 ? restore : undefined)
  }, [location.key, location.hash, topicId, pointId, locate, cancel, navigationType])

  useLayoutEffect(() => () => {
    cancel()
    // StrictMode replays the effect setup on this same hook instance. Its
    // initial navigation is new work; a user cancellation never clears this key.
    lastKey.current = undefined
    headingAnimation.current?.cancel()
    clearTimeout(emphasisTimer.current)
  }, [cancel])

  const onAnchor: ResearchAnchorHandler = useCallback((event, id) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !RESEARCH_ANCHORS.includes(id)) return
    event.preventDefault()
    focusTarget.current = event.detail === 0 ? id : undefined
    if (location.pathname === '/research' && location.hash === `#${id}`) locate(id)
    else navigate({ pathname: '/research', search: location.search, hash: `#${id}` })
  }, [location.pathname, location.hash, location.search, locate, navigate])
  return { active, onAnchor }
}

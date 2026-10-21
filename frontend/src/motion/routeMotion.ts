import { flushSync } from 'react-dom'
import { MotionCoordinator, type NativeTransition } from './coordinator'

interface RouteIdentity { key: string; pathname: string; search: string; index?: number }
type TransitionDocument = { startViewTransition?: (update: () => Promise<void>) => NativeTransition }
const coordinator = new MotionCoordinator()
const readyListeners = new Set<(route: RouteIdentity) => void>()
let committed: RouteIdentity | undefined
let lastReady: RouteIdentity | undefined
let replayingPop = false
const fallbackAnimations = new Set<Animation>()
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const research = (path: string) => /^\/(research|about)(?:\/|$)/.test(path)
const authenticationOwnsMotion = () => /^(auth-pending|auth-success|logout-preparing|logout-return)$/.test(document.documentElement.dataset.loginTransition ?? '')

export function isModuleNavigation(from: string, to: string) {
  return from !== to && from !== '/login' && to !== '/login' && !(research(from) && research(to))
}

function moduleNodes(main: HTMLElement): HTMLElement[] {
  const explicit = [...main.querySelectorAll<HTMLElement>('[data-route-module]')]
    .filter(node => !node.parentElement?.closest('[data-route-module]'))
  const scoped = [...main.querySelectorAll<HTMLElement>('[data-route-module-scope]')].flatMap(scope => {
    let children = [...scope.children] as HTMLElement[]
    // A tool may render one presentation shell. Its own context/body are the
    // visual modules; keep the React component and its subscriptions untouched.
    while (children.length === 1 && children[0].children.length > 1 && children[0].tagName !== 'CANVAS') {
      children = [...children[0].children] as HTMLElement[]
    }
    return children
  })
  const candidates = [...explicit, ...scoped]
  const roots = candidates.length ? candidates : [...main.children] as HTMLElement[]
  return roots.filter(node => {
    if (node.closest('[data-route-preparing="true"]') || node.tagName === 'SCRIPT') return false
    const box = node.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight
  }).slice(0, 8)
}

function prepareModules(route: RouteIdentity, names: Set<string>, restore: Map<HTMLElement, () => void>) {
  const main = document.getElementById('main-content')
  if (!main) return
  const prefix = route.pathname.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 64) || 'home'
  const nodes = moduleNodes(main)
  // Read all bounds in moduleNodes before writing any animation styles.
  nodes.forEach((node, index) => {
    if (!restore.has(node)) {
      const previous = node.style.viewTransitionName
      restore.set(node, () => { node.style.viewTransitionName = previous; delete node.dataset.routeModuleActive })
    }
    const name = `route${prefix}-module-${index}`
    names.add(name)
    node.style.viewTransitionName = name
    node.dataset.routeModuleActive = String(index)
  })
}

function playFallback() {
  const main = document.getElementById('main-content')
  if (!main || reduced() || authenticationOwnsMotion()) return
  moduleNodes(main).forEach((node, index) => {
    const animation = node.animate([
      { opacity: .25, clipPath: 'inset(100% 0 0 0)', transform: 'translateY(8px)' },
      { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'none' },
    ], { duration: 330, delay: index * 24, easing: 'cubic-bezier(.16,1,.3,1)' })
    fallbackAnimations.add(animation)
    void animation.finished.catch(() => {}).finally(() => fallbackAnimations.delete(animation))
  })
}

function stopFallback() {
  fallbackAnimations.forEach(animation => animation.cancel())
  fallbackAnimations.clear()
}

export function notifyRouteCommitted(route: RouteIdentity) { committed = route }
export function notifyRouteReady(route: RouteIdentity) {
  committed = route
  lastReady = route
  readyListeners.forEach(listener => listener(route))
}

/** Every route write, including popstate, uses this single document VT entrance. */
export function transitionRoute(commit: () => void, from: RouteIdentity, targetPath: string) {
  coordinator.cancel()
  stopFallback()
  const enabled = isModuleNavigation(from.pathname, targetPath) && !authenticationOwnsMotion()
  if (!enabled) {
    coordinator.cancel()
    flushSync(commit)
    return
  }
  const names = new Set<string>()
  const restore = new Map<HTMLElement, () => void>()
  const style = document.createElement('style')
  style.dataset.routeMotion = 'modules'
  let unsubscribe: (() => void) | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let alive = true
  const doc = document as unknown as TransitionDocument
  const native = Boolean(doc.startViewTransition && !reduced())
  if (native) prepareModules(from, names, restore)
  const sheet = () => {
    style.textContent = [...names].map(name => `
::view-transition-group(${name}){animation:none;}
::view-transition-old(${name}){animation:route-module-fold-out 170ms cubic-bezier(.45,0,.9,.45) both;}
::view-transition-new(${name}){animation:route-module-fold-in 330ms cubic-bezier(.16,1,.3,1) both;animation-delay:${Number(name.substring(name.lastIndexOf('-') + 1)) * 24}ms;}
`).join('')
    if (!style.isConnected) document.head.append(style)
  }
  if (native) sheet()
  const ready = new Promise<void>(resolve => {
    const check = (route: RouteIdentity) => {
      if (route.key === from.key || route.pathname !== window.location.pathname || route.search !== window.location.search) return
      if (native) { prepareModules(route, names, restore); sheet() }
      resolve()
    }
    readyListeners.add(check)
    unsubscribe = () => readyListeners.delete(check)
    // A synchronous Router flush can report readiness before commit returns.
    // The listener is registered first; lastReady is only a matching new key.
    if (lastReady) check(lastReady)
  })
  document.documentElement.dataset.routeTransition = native ? 'snapshot-pending' : 'fallback-pending'
  void coordinator.run({
    commit: () => flushSync(commit),
    ready: () => ready,
    presented: usedNative => {
      unsubscribe?.()
      document.documentElement.dataset.routeTransition = usedNative ? 'module-snapshots' : 'module-fallback'
      if (!usedNative) playFallback()
    },
    cleanup: () => {
      alive = false
      unsubscribe?.()
      if (watchdog) clearTimeout(watchdog)
      restore.forEach(reset => reset())
      style.remove()
      delete document.documentElement.dataset.routeTransition
    },
  }, native ? update => {
    // The sole startViewTransition call in the application.
    const transition = doc.startViewTransition!(update)
    // A slow lazy route must expose its real loading/error UI. This skips only
    // the visual capture; it never fakes a route-ready signal or a DOM commit.
    watchdog = setTimeout(() => { if (alive) coordinator.skipVisual() }, 1800)
    return transition
  } : undefined)
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const auth = () => { coordinator.cancel(); stopFallback() }
  const pop = (event: PopStateEvent) => {
    if (replayingPop || !committed) return
    const from = committed
    const target = window.location.pathname
    const index = Number(event.state?.idx ?? 0)
    document.documentElement.style.setProperty('--navigation-direction', index < (from.index ?? index) ? '-1' : '1')
    if (!isModuleNavigation(from.pathname, target) || authenticationOwnsMotion() || !('startViewTransition' in document) || reduced()) {
      // Native history still reaches BrowserRouter once. No unsupported API can
      // swallow the event; fallback route readiness is observed independently.
      transitionRoute(() => {}, from, target)
      return
    }
    event.stopImmediatePropagation()
    transitionRoute(() => {
      replayingPop = true
      try { window.dispatchEvent(new PopStateEvent('popstate', { state: event.state })) }
      finally { replayingPop = false }
    }, from, target)
  }
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const changed = () => { if (media.matches) { coordinator.skipVisual(); stopFallback() } }
  document.addEventListener('workspace:auth-transition', auth)
  window.addEventListener('popstate', pop, { capture: true })
  media.addEventListener('change', changed)
  if (import.meta.hot) import.meta.hot.dispose(() => {
    auth()
    document.removeEventListener('workspace:auth-transition', auth)
    window.removeEventListener('popstate', pop, { capture: true })
    media.removeEventListener('change', changed)
  })
}

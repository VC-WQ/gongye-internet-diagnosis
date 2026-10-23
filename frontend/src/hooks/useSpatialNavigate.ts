import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate, type NavigateFunction, type NavigateOptions, type To } from 'react-router-dom'

type Transition = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void }
let active: Transition | undefined

/** Native shared-element snapshots keep the header/device anchor continuous across modes. */
export function useSpatialNavigate(): NavigateFunction {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(((to: To | number, options?: NavigateOptions) => {
    const run = () => { if (typeof to === 'number') navigate(to); else navigate(to, options) }
    const doc = document as Document & { startViewTransition?: (update: () => void | Promise<void>) => Transition }
    document.documentElement.style.setProperty('--navigation-direction', to === -1 ? '-1' : '1')
    active?.skipTransition()
    const research = (path: string) => /^\/research(?:\/|$)/.test(path)
    const target = typeof to === 'number' ? location.pathname : typeof to === 'string' ? to.split('?')[0] || location.pathname : to.pathname ?? location.pathname
    // The stable research shell animates its article. A second full-page snapshot
    // would fade the tree and charts again and make navigation look like a reload.
    if ((research(location.pathname) && research(target)) || !doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { run(); return }
    const next = doc.startViewTransition(() => {
      if (typeof to !== 'number') { flushSync(run); return }
      // History traversal commits on popstate, after navigate() has returned.
      return new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>
        const done = () => { clearTimeout(timer); window.removeEventListener('popstate', changed); resolve() }
        const changed = () => requestAnimationFrame(() => requestAnimationFrame(done))
        window.addEventListener('popstate', changed, { once: true })
        timer = setTimeout(done, 600)
        run()
      })
    })
    active = next
    // Canceling a snapshot rejects ready even though its DOM update still succeeds.
    void next.ready.catch(() => {})
    void next.finished.catch(() => {}).finally(() => { if (active === next) active = undefined })
  }) as NavigateFunction, [navigate, location.pathname])
}

import { useCallback } from 'react'
import { useLocation, useNavigate, type NavigateFunction, type NavigateOptions, type To } from 'react-router-dom'
import { transitionRoute } from '../motion/routeMotion'

export interface SpatialNavigateOptions extends NavigateOptions { signal?: AbortSignal }
export interface SpatialNavigateFunction {
  (to: To, options?: SpatialNavigateOptions): void
  (delta: number): void
}

/** Native shared-element snapshots keep the header/device anchor continuous across modes. */
export function useSpatialNavigate(): SpatialNavigateFunction {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(((to: To | number, options?: SpatialNavigateOptions) => {
    // History uses the same capture/replay path as the browser's own buttons.
    if (typeof to === 'number') { navigate(to); return }
    const { signal, ...routerOptions } = options ?? {}
    if (signal?.aborted) return
    const target = typeof to === 'string' ? new URL(to, window.location.href).pathname : to.pathname ?? location.pathname
    document.documentElement.style.setProperty('--navigation-direction', '1')
    transitionRoute(() => { if (!signal?.aborted) navigate(to, routerOptions) }, {
      key: location.key, pathname: location.pathname, search: location.search,
      index: Number(window.history.state?.idx ?? 0),
    }, target, signal)
  }) as NavigateFunction, [navigate, location.key, location.pathname, location.search])
}

import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { registerPicoPageAdapter, type PicoPageAdapter } from './pageSnapshot'

/** Register business state without subscribing Pico to every telemetry render. Read on demand. */
export function usePicoPageAdapter(value: Omit<PicoPageAdapter, 'route' | 'search'>) {
  const location = useLocation()
  const latest = useRef<PicoPageAdapter>({ ...value, route: location.pathname, search: location.search })
  latest.current = { ...value, route: location.pathname, search: location.search }
  useLayoutEffect(() => registerPicoPageAdapter(() => latest.current), [])
}

import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useLoginTransitionOptional } from './LoginTransition'
import { notifyRouteCommitted, notifyRouteReady } from './routeMotion'

/** Wait for a real route and its declared preparation, never a redirect's empty shell. */
export default function RouteReady() {
  const location = useLocation()
  const transition = useLoginTransitionOptional()
  const markReady = transition?.markTargetReady
  useLayoutEffect(() => {
    const route = { key: location.key, pathname: location.pathname, search: location.search, index: Number(window.history.state?.idx ?? 0) }
    notifyRouteCommitted(route)
    const main = document.getElementById('main-content')
    if (!main) return
    main.dataset.routeKey = location.key
    main.dataset.routeReady = 'false'
    let active = true
    const ready = () => {
      if (!active) return
      if (!main.childElementCount || main.querySelector('[data-route-preparing="true"]')) return
      observer.disconnect()
      main.dataset.routeReady = 'true'
      notifyRouteReady(route)
      markReady?.()
    }
    const observer = new MutationObserver(ready)
    observer.observe(main, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['data-route-preparing'],
    })
    ready()
    return () => { active = false; observer.disconnect() }
  }, [markReady, location.key, location.pathname, location.search])
  return null
}

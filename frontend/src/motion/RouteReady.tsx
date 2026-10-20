import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useLoginTransitionOptional } from './LoginTransition'

/** Wait for a real route and its declared preparation, never a redirect's empty shell. */
export default function RouteReady() {
  const location = useLocation()
  const transition = useLoginTransitionOptional()
  const markReady = transition?.markTargetReady
  useEffect(() => {
    if (!markReady) return
    const main = document.getElementById('main-content')
    if (!main) return
    const ready = () => {
      if (!main.childElementCount || main.querySelector('[data-route-preparing="true"]')) return
      observer.disconnect()
      markReady()
    }
    const observer = new MutationObserver(ready)
    observer.observe(main, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['data-route-preparing'],
    })
    ready()
    return () => observer.disconnect()
  }, [markReady, location.key])
  return null
}

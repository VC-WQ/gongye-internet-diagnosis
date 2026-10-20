import { useLayoutEffect, type RefObject } from 'react'
import { useLoginTransitionOptional } from './LoginTransition'
import { sampleFactoryEntrance, type FactoryEntry } from './loginTimeline'
import { FACTORY_ENTRANCE } from './tokens'
import './factoryEntrance.css'

/** Six spatial groups share the login reveal's clock; this hook creates no RAF. */
export function useFactoryEntrance(ref: RefObject<HTMLElement>) {
  const transition = useLoginTransitionOptional()
  const phase = transition?.phase
  const reduced = transition?.reducedMotion
  const subscribe = transition?.subscribeEntrance
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !subscribe) return
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-factory-entry]')]
    const reset = () => {
      nodes.forEach((node) => {
        node.style.removeProperty('opacity')
        node.style.removeProperty('transform')
        node.style.removeProperty('will-change')
      })
      root.removeAttribute('data-factory-entering')
    }
    if (reduced || (phase !== 'auth-pending' && phase !== 'auth-success')) { reset(); return }
    root.dataset.factoryEntering = 'true'
    const update = (elapsed: number) => {
      for (const node of nodes) {
        const entry = node.dataset.factoryEntry as FactoryEntry
        if (!(entry in FACTORY_ENTRANCE)) continue
        const frame = sampleFactoryEntrance(Math.max(0, elapsed), entry)
        node.style.opacity = String(frame.opacity)
        node.style.transform = `translate(${frame.x}px,${frame.y}px)`
        node.style.willChange = frame.done ? 'auto' : 'transform, opacity'
        if (import.meta.env.DEV) node.dataset.factoryProgress = frame.opacity.toFixed(4)
      }
    }
    update(-1)
    const off = subscribe(update)
    return () => { off(); reset() }
  }, [ref, phase, reduced, subscribe])
}

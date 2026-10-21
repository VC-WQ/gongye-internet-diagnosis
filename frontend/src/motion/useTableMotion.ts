import { useLayoutEffect, useRef, useState } from 'react'
import { EASE_CSS, MOTION, prefersReducedMotion } from './tokens'
import { tableRowStart } from './tableRowMotion'

/** One live Ant table. Removed records disappear immediately and cannot be operated. */
export function useTableMotion(identity: string) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const previousHost = useRef<HTMLDivElement | null>(null)
  const targets = useRef<Map<string, number>>()
  const owned = useRef(new Map<HTMLElement, Animation>())
  useLayoutEffect(() => {
    if (host !== previousHost.current) {
      targets.current = undefined
      previousHost.current = host
    }
    if (!host) {
      owned.current.forEach((animation, node) => { animation.cancel(); delete node.dataset.rowMotion })
      owned.current.clear()
      return
    }
    const origin = host.getBoundingClientRect().top
    // Read every row before cancelling/writing. A running transform belongs only
    // to this hook; subtract it to recover the new untransformed layout target.
    const rows = [...host.querySelectorAll<HTMLElement>('tbody > tr[data-row-key]')].map(node => {
      const style = owned.current.has(node) ? getComputedStyle(node) : undefined
      let offset = 0
      if (style?.transform && style.transform !== 'none') offset = new DOMMatrixReadOnly(style.transform).m42
      return { node, id: node.dataset.rowKey!, target: node.getBoundingClientRect().top - origin - offset,
        offset, opacity: style ? Number(style.opacity) : 1 }
    })
    owned.current.forEach((animation, node) => { animation.cancel(); delete node.dataset.rowMotion })
    owned.current.clear()
    const previous = targets.current
    targets.current = new Map(rows.map(row => [row.id, row.target]))
    if (!previous || prefersReducedMotion()) return
    for (const row of rows) {
      const start = tableRowStart(previous.get(row.id), row.target, row.offset, row.opacity)
      if (!start) continue
      const animation = row.node.animate([
        { transform: `translateY(${start.y}px)`, opacity: start.opacity },
        { transform: 'translateY(0)', opacity: 1 },
      ], { duration: MOTION.tableReflow.duration, easing: EASE_CSS.outward })
      row.node.dataset.rowMotion = 'active'
      owned.current.set(row.node, animation)
      void animation.finished.catch(() => {}).finally(() => {
        if (owned.current.get(row.node) === animation) {
          owned.current.delete(row.node)
          delete row.node.dataset.rowMotion
        }
      })
    }
  }, [identity, host])
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const stop = () => {
      owned.current.forEach((animation, node) => { animation.cancel(); delete node.dataset.rowMotion })
      owned.current.clear()
    }
    const changed = () => { if (media.matches) stop() }
    media.addEventListener('change', changed)
    return () => { media.removeEventListener('change', changed); stop(); targets.current = undefined }
  }, [])
  useLayoutEffect(() => {
    if (!host) return
    const observer = new ResizeObserver(() => {
      if (owned.current.size) return
      const origin = host.getBoundingClientRect().top
      targets.current = new Map([...host.querySelectorAll<HTMLElement>('tbody > tr[data-row-key]')]
        .map(node => [node.dataset.rowKey!, node.getBoundingClientRect().top - origin]))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [host])
  return setHost
}

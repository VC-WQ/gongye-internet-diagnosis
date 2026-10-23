import { useLayoutEffect, useRef } from 'react'
import { textHandoff } from './textHandoff'
import { DURATION, EASE_CSS, prefersReducedMotion } from './tokens'
import './mechanical.css'

/** Retain the entire visible composition when interrupted, not merely the incoming string. */
export default function FlipText({ value, label, className = '' }: { value: string; label?: string; className?: string }) {
  const windowRef = useRef<HTMLSpanElement>(null), track = useRef<HTMLSpanElement>(null)
  const probe = useRef<HTMLSpanElement>(null), latest = useRef(value), revision = useRef(0)
  const owned = useRef<Animation[]>([]), previous = useRef<string>()
  latest.current = value
  const cancel = () => { owned.current.forEach(a => a.cancel()); owned.current = [] }
  const layer = (text: string, y = 0) => {
    const node = document.createElement('span')
    node.className = 'mechanical-text__layer'; node.textContent = text
    node.style.transform = `translateY(${y}px)`
    return node
  }
  const settle = () => {
    revision.current++; cancel()
    track.current?.replaceChildren(layer(latest.current))
    if (windowRef.current) {
      const root = windowRef.current, measure = probe.current
      root.dataset.handoffState = 'settled'
      // Reserve both compositions only while they share the window. A long
      // title must not leave a permanent blank line after a shorter title wins.
      if (measure) {
        root.dataset.reservedWidth = String(measure.offsetWidth)
        root.dataset.reservedHeight = String(Math.max(1, measure.offsetHeight))
        root.style.setProperty('--handoff-reserved-width', `${measure.offsetWidth}px`)
        root.style.minHeight = `${Math.max(1, measure.offsetHeight)}px`
      }
    }
  }
  useLayoutEffect(() => {
    const root = windowRef.current!, container = track.current!, measure = probe.current!
    const height = Math.max(measure.offsetHeight, 1)
    // Reserve width within the current responsive container; never accumulate old wrapped heights.
    root.style.setProperty('--handoff-reserved-width', `${Math.max(measure.offsetWidth, Number(root.dataset.reservedWidth) || 0)}px`)
    root.dataset.reservedWidth = String(Math.max(measure.offsetWidth, Number(root.dataset.reservedWidth) || 0))
    const reservedHeight = Math.max(height, Number(root.dataset.reservedHeight) || 0)
    root.dataset.reservedHeight = String(reservedHeight)
    root.style.minHeight = `${reservedHeight}px`
    if (previous.current === value) return
    previous.current = value
    if (!container.children.length || prefersReducedMotion() || !container.animate) { settle(); return }
    const rect = root.getBoundingClientRect()
    const snapshots = Array.from(container.children).map(child => {
      const r = child.getBoundingClientRect(), y = r.top - rect.top
      return { text: child.textContent ?? '', y, height: r.height }
    })
    const epoch = ++revision.current
    cancel()
    const { visible, distance } = textHandoff(snapshots, reservedHeight)
    const nodes = visible.map(item => layer(item.text, item.y))
    const incoming = layer(value, distance)
    container.replaceChildren(...nodes, incoming)
    root.dataset.handoffState = 'moving'
    owned.current = [...nodes, incoming].map((node, i) => {
      const y = i < visible.length ? visible[i].y : distance
      return node.animate([{ transform: `translateY(${y}px)` }, { transform: `translateY(${y - distance}px)` }],
        { duration: DURATION.flip * 1000, easing: EASE_CSS.balanced, fill: 'forwards' })
    })
    void owned.current[owned.current.length - 1].finished.then(() => { if (epoch === revision.current) settle() }).catch(() => {})
  }, [value])
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => { if (media.matches) settle() }
    let width = windowRef.current?.parentElement?.clientWidth
    const resize = new ResizeObserver(() => {
      const next = windowRef.current?.parentElement?.clientWidth
      if (next === width) return
      width = next
      if (windowRef.current && probe.current) {
        windowRef.current.dataset.reservedWidth = String(probe.current.offsetWidth)
        windowRef.current.style.setProperty('--handoff-reserved-width', `${probe.current.offsetWidth}px`)
        const height = probe.current.offsetHeight
        windowRef.current.dataset.reservedHeight = String(height)
        windowRef.current.style.minHeight = `${height}px`
      }
      settle()
    })
    if (windowRef.current?.parentElement) resize.observe(windowRef.current.parentElement)
    let disposed = false
    void document.fonts.ready.then(() => {
      if (disposed || !windowRef.current || !probe.current) return
      const height = Math.max(probe.current.offsetHeight, Number(windowRef.current.dataset.reservedHeight) || 0)
      windowRef.current.dataset.reservedHeight = String(height); windowRef.current.style.minHeight = `${height}px`
    })
    media.addEventListener('change', change)
    return () => { disposed = true; revision.current++; cancel(); resize.disconnect(); media.removeEventListener('change', change) }
  }, [])
  return <span ref={windowRef} className={`mechanical-text ${className}`} title={value} data-handoff-state="settled">
    <span className="motion-sr-only">{label ?? value}</span>
    <span ref={probe} className="mechanical-text__probe" aria-hidden="true">{value}</span>
    <span ref={track} className="mechanical-text__track" aria-hidden="true" />
  </span>
}

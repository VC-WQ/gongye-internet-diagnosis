import { useLayoutEffect, useRef, type RefObject } from 'react'
import { DURATION, EASE_CSS, prefersReducedMotion } from './tokens'
import './mechanical.css'

/** A separate measured rail; rows, focus and scroll stay in their own owners. */
export default function FlipSelection({ container, identity }: { container: RefObject<HTMLElement>; identity?: string }) {
  const rail = useRef<HTMLSpanElement>(null)
  const animation = useRef<Animation>()
  const previous = useRef<{ id?: string; top: number; height: number; visible: boolean }>()
  useLayoutEffect(() => {
    const root = container.current, node = rail.current
    if (!root || !node) return
    const place = (animate: boolean) => {
      const selected = root.querySelector<HTMLElement>('[aria-selected="true"]')
      if (!selected) { node.style.visibility = 'hidden'; previous.current = undefined; return }
      const r = root.getBoundingClientRect(), b = selected.getBoundingClientRect()
      const top = b.top - r.top + root.scrollTop, height = b.height
      const visible = b.bottom > r.top && b.top < r.bottom
      const old = previous.current
      const from = animation.current?.playState === 'running' ? getComputedStyle(node).transform : `translateY(${old?.top ?? top}px)`
      animation.current?.cancel()
      node.style.visibility = visible ? 'visible' : 'hidden'
      node.style.height = `${height}px`
      node.style.transform = `translateY(${top}px)`
      if (animate && visible && !prefersReducedMotion()) {
        animation.current = node.animate(old?.visible ? [
          { transform: from, opacity: 1 }, { transform: `translateY(${top}px)`, opacity: 1 },
        ] : [
          { transform: `translateY(${top}px) scaleY(.2)`, opacity: 0 }, { transform: `translateY(${top}px) scaleY(1)`, opacity: 1 },
        ], { duration: DURATION.selection * 1000, easing: EASE_CSS.outward })
      }
      previous.current = { id: identity, top, height, visible }
    }
    place(Boolean(previous.current) && previous.current?.id !== identity)
    const moved = () => place(false)
    const observer = new ResizeObserver(moved)
    observer.observe(root)
    root.addEventListener('scroll', moved, { passive: true })
    return () => { observer.disconnect(); root.removeEventListener('scroll', moved) }
  }, [container, identity])
  useLayoutEffect(() => () => animation.current?.cancel(), [])
  return <span ref={rail} className="selection-rail" aria-hidden="true" />
}

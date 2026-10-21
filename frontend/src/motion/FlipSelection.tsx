import { useLayoutEffect, useRef, type RefObject } from 'react'
import { DURATION, EASE_CSS, prefersReducedMotion } from './tokens'
import './mechanical.css'

/** A separate measured rail; rows, focus and scroll stay in their own owners. */
export default function FlipSelection({ container, identity, selector = '[aria-selected="true"]' }: { container: RefObject<HTMLElement>; identity?: string; selector?: string }) {
  const rail = useRef<HTMLSpanElement>(null)
  const animation = useRef<Animation>()
  const previous = useRef<{ id?: string; top: number; height: number; visible: boolean }>()
  useLayoutEffect(() => {
    const root = container.current, node = rail.current
    if (!root || !node) return
    const place = (animate: boolean) => {
      const selected = root.querySelector<HTMLElement>(selector)
      if (!selected) {
        animation.current?.cancel(); animation.current = undefined
        node.style.visibility = 'hidden'; previous.current = undefined; return
      }
      const r = root.getBoundingClientRect(), b = selected.getBoundingClientRect()
      const top = b.top - r.top + root.scrollTop, height = b.height
      const visible = b.bottom > r.top && b.top < r.bottom
      const old = previous.current
      const from = animation.current?.playState === 'running' ? getComputedStyle(node).transform : `translateY(${old?.top ?? top}px)`
      animation.current?.cancel()
      animation.current = undefined
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
    let width = root.clientWidth, height = root.clientHeight
    const observer = new ResizeObserver(() => {
      // observe() sends an initial notification even when size did not change.
      // It must not cancel the selection animation just started by this effect.
      if (width === root.clientWidth && height === root.clientHeight) return
      width = root.clientWidth; height = root.clientHeight
      moved()
    })
    observer.observe(root)
    root.addEventListener('scroll', moved, { passive: true })
    // Cancelling exposes the inline transform already set to the real target.
    // Re-measure as well: a preference change must never leave a rail in flight.
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = () => { if (media.matches) place(false) }
    media.addEventListener('change', reduced)
    return () => {
      observer.disconnect(); root.removeEventListener('scroll', moved)
      media.removeEventListener('change', reduced)
    }
  }, [container, identity, selector])
  useLayoutEffect(() => () => animation.current?.cancel(), [])
  return <span ref={rail} className="selection-rail" aria-hidden="true" />
}

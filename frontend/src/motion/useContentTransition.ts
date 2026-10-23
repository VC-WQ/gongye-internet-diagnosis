import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { DURATION, EASE_CSS, prefersReducedMotion } from './tokens'

/** 容器身份固定，内容身份变化时原位过渡；快速变化从当前状态重新开始。 */
export function useContentTransition<T>(
  identity: T,
  ref: RefObject<HTMLElement>,
) {
  const previous = useRef<T>(identity)
  const ownedAnimation = useRef<Animation>()
  useEffect(() => () => ownedAnimation.current?.cancel(), [])
  useLayoutEffect(() => {
    if (previous.current === identity) return
    previous.current = identity
    const node = ref.current
    if (!node) return
    // Only cancel this hook's animation. Child/chart motion has another owner.
    const interrupted = ownedAnimation.current?.playState === 'running'
    const current = interrupted ? getComputedStyle(node) : undefined
    const from = current ? { opacity: current.opacity, transform: current.transform }
      : { opacity: 0.7, transform: 'translateY(6px)' }
    ownedAnimation.current?.cancel()
    if (prefersReducedMotion()) return
    const animation = node.animate(
      [
        from,
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: DURATION.content * 1000,
        easing: EASE_CSS.outward,
      },
    )
    ownedAnimation.current = animation
    void animation.finished.catch(() => {}).finally(() => {
      if (ownedAnimation.current === animation) ownedAnimation.current = undefined
    })
  }, [identity, ref])
}

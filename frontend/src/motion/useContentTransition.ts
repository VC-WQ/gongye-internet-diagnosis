import { useLayoutEffect, useRef, type RefObject } from 'react'
import { DURATION, EASE_CSS, prefersReducedMotion } from './tokens'

/** 容器身份固定，内容身份变化时原位过渡；快速变化从当前状态重新开始。 */
export function useContentTransition<T>(
  identity: T,
  ref: RefObject<HTMLElement>,
) {
  const previous = useRef<T>(identity)
  useLayoutEffect(() => {
    if (previous.current === identity) return
    previous.current = identity
    const node = ref.current
    if (!node || prefersReducedMotion()) return
    node.getAnimations().forEach((animation) => animation.cancel())
    node.animate(
      [
        { opacity: 0.35, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: DURATION.content * 1000,
        easing: EASE_CSS.outward,
      },
    )
  }, [identity, ref])
}

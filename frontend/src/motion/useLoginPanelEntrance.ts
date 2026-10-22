import { useLayoutEffect, type RefObject } from 'react'
import { renderLoginEntries, type SubscribeIntro } from './loginIntro'

interface PanelTransition {
  phase: string
  reducedMotion: boolean
  subscribeIntroProgress: SubscribeIntro
}

export function useLoginPanelEntrance(ref: RefObject<HTMLElement>, transition: PanelTransition, mode: string) {
  const { phase, reducedMotion, subscribeIntroProgress } = transition
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const reset = () => renderLoginEntries(root, { epoch: 0, progress: 1, active: false }, false)
    // C captures this newly mounted form during the parent's layout effect.
    // Static/default-visible is essential; introDone=false also occurs in C.
    if (reducedMotion || (phase !== 'boot' && phase !== 'intro')) { reset(); return }
    const off = subscribeIntroProgress((frame) => {
      try {
        renderLoginEntries(root, frame, matchMedia('(max-width: 780px)').matches)
      } catch (error) {
        reset()
        throw error // channel isolates a failed decorative subscriber from A
      }
    })
    return () => { off(); reset() }
  }, [ref, phase, reducedMotion, subscribeIntroProgress, mode])
}

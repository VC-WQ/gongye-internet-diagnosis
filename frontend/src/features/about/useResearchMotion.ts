import { useEffect, type RefObject } from 'react'
import { useUiPreferences } from '../../services/uiPrefs'

/** Chapters reveal their own method/relationship, never rotate a chart's axes. */
export function useResearchMotion(root: RefObject<HTMLElement>) {
  const { reducedMotion } = useUiPreferences()
  useEffect(() => {
    const node = root.current
    if (!node) return
    const chapters = [...node.querySelectorAll<HTMLElement>('[data-research-chapter]')]
    const active = new Set<HTMLElement>()
    let frame = 0
    const wide = matchMedia('(min-width: 1350px)')
    const paint = () => {
      frame = 0
      const readings = [...active].map(chapter => ({ chapter, rect: chapter.getBoundingClientRect() }))
      for (const { chapter, rect } of readings) {
        const progress = Math.max(0, Math.min(1, (innerHeight - rect.top) / (rect.height + innerHeight)))
        chapter.style.setProperty('--research-method-shift', `${-10 * progress}px`)
        chapter.style.setProperty('--research-reading-progress', String(progress))
      }
    }
    const schedule = () => { if (!reducedMotion && wide.matches && active.size && !frame) frame = requestAnimationFrame(paint) }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        ;(entry.target as HTMLElement).dataset.researchVisible = 'true'
        observer.unobserve(entry.target)
      })
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0 })
    chapters.forEach(chapter => observer.observe(chapter))
    const focus = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const chapter = entry.target as HTMLElement
        if (entry.isIntersecting) active.add(chapter)
        else active.delete(chapter)
      })
      schedule()
    }, { threshold: 0 })
    chapters.filter(chapter => ['signal', 'health'].includes(chapter.dataset.researchChapter ?? '')).forEach(chapter => focus.observe(chapter))
    const changed = () => {
      chapters.forEach(chapter => { chapter.style.removeProperty('--research-method-shift'); chapter.style.removeProperty('--research-reading-progress') })
      schedule()
    }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    wide.addEventListener('change', changed)
    return () => {
      observer.disconnect(); focus.disconnect(); cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); wide.removeEventListener('change', changed)
      chapters.forEach(chapter => { chapter.style.removeProperty('--research-method-shift'); chapter.style.removeProperty('--research-reading-progress') })
    }
  }, [root, reducedMotion])
}

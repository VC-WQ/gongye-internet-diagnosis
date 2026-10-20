import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { DURATION, EASE_CSS } from '../motion/tokens'

export interface PrimaryNavItem {
  key: string
  label: string
  path: string
}

/** 顶部一级导航：指示器在稳定容器内测量滑动，首帧/resize 直接对齐不从角落飞来。 */
export default function PrimaryNav({
  items,
  active,
  onNavigate,
}: {
  items: PrimaryNavItem[]
  active: string
  onNavigate: (item: PrimaryNavItem) => void
}) {
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const mounted = useRef(false)
  const reduced = useRef(false)

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduced.current = media.matches
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const place = useCallback(
    (animate: boolean) => {
      const nav = navRef.current
      const button = buttons.current.get(active)
      const indicator = indicatorRef.current
      if (!nav || !button || !indicator) return
      const navRect = nav.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      const left = buttonRect.left - navRect.left
      const width = buttonRect.width
      const previousLeft = Number(indicator.dataset.left ?? left)
      const previousWidth = Number(indicator.dataset.width ?? width)
      indicator.dataset.left = String(left)
      indicator.dataset.width = String(width)
      indicator.getAnimations().forEach((animation) => animation.cancel())
      if (!animate || reduced.current) {
        indicator.style.transform = `translateX(${left}px)`
        indicator.style.width = `${width}px`
        return
      }
      const animation = indicator.animate(
        [
          {
            transform: `translateX(${previousLeft}px)`,
            width: `${previousWidth}px`,
          },
          {
            transform: `translateX(${left}px)`,
            width: `${width}px`,
          },
        ],
        {
          duration: DURATION.selection * 1000,
          easing: EASE_CSS.outward,
          fill: 'forwards',
        },
      )
      const finish = () => {
        indicator.style.transform = `translateX(${left}px)`
        indicator.style.width = `${width}px`
        animation.cancel()
      }
      animation.addEventListener('finish', finish)
    },
    [active],
  )

  useLayoutEffect(() => {
    place(mounted.current)
    mounted.current = true
  }, [place])

  const placeRef = useRef(place)
  placeRef.current = place

  useEffect(() => {
    const onResize = () => placeRef.current(false)
    window.addEventListener('resize', onResize)
    void document.fonts?.ready
      .then(() => placeRef.current(false))
      .catch(() => undefined)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <nav ref={navRef} className="primary-nav" aria-label="主导航">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          ref={(node) => {
            if (node) buttons.current.set(item.key, node)
            else buttons.current.delete(item.key)
          }}
          className={`primary-nav__item ${active === item.key ? 'is-active' : ''}`}
          aria-current={active === item.key ? 'page' : undefined}
          onClick={() => onNavigate(item)}
        >
          {item.label}
        </button>
      ))}
      <span
        ref={indicatorRef}
        className="primary-nav__indicator"
        aria-hidden="true"
      />
    </nav>
  )
}

import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePico } from '../core/PicoProvider'
import PicoHeader from './PicoHeader'
import PicoConversation from './PicoConversation'
import '../pico.css'

const PicoAvatar = lazy(() => import('./PicoAvatar'))

export default function PicoDock() {
  const { open, setOpen, toggle, unread, emotion } = usePico()
  const location = useLocation()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dockRef = useRef<HTMLDivElement>(null)
  const morphRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const orbRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)
  const dragging = useRef<{
    x: number
    y: number
    left: number
    top: number
    width: number
    height: number
    origin: typeof offset
  }>()
  const dragged = useRef(false)

  useEffect(() => {
    const changed = () => {
      setOffset({ x: 0, y: 0 })
      dragging.current = undefined
      dragged.current = false
    }
    window.addEventListener('resize', changed)
    return () => window.removeEventListener('resize', changed)
  }, [])

  // 面板打开期间锁住背景滚动，关闭/卸载后恢复原样。
  useEffect(() => {
    if (!open) return
    const body = document.body
    const previousOverflow = body.style.overflow
    const previousPadding = body.style.paddingRight
    const gap = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gap > 0) body.style.paddingRight = `${gap}px`
    return () => {
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
    }
  }, [open])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (open) {
      panel.removeAttribute('inert')
      panel.removeAttribute('aria-hidden')
    } else {
      panel.setAttribute('inert', '')
      panel.setAttribute('aria-hidden', 'true')
    }
  }, [open])

  useEffect(() => {
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    if (open) {
      setOffset({ x: 0, y: 0 })
      timer = setTimeout(() => {
        panelRef.current
          ?.querySelector<HTMLTextAreaElement>('[data-pico-input]')
          ?.focus({ preventScroll: true })
      }, 380)
    } else if (wasOpen.current) {
      frame = requestAnimationFrame(() =>
        orbRef.current?.focus({ preventScroll: true }),
      )
    }
    wasOpen.current = open
    return () => {
      cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // 进入 Pico 工作台时收起 Dock，返回时不会以“透明打开”状态闪现。
  useEffect(() => {
    if (location.pathname.startsWith('/tools/pico') && open) setOpen(false)
  }, [location.pathname, open, setOpen])

  // Pico 工作台本身就是完整会话，避免同一页面出现两个助手入口。
  if (location.pathname.startsWith('/tools/pico')) return null

  return (
    <div
      ref={dockRef}
      className="pico-dock"
      data-open={open}
      style={{
        transform: open ? undefined : `translate(${offset.x}px,${offset.y}px)`,
      }}
    >
      <div
        ref={morphRef}
        className={`pico-morph ${open ? 'is-open' : 'is-closed'}`}
        data-pico-phase={open ? 'open' : 'closed'}
      >
        <div className="pico-morph__avatar">
          <Suspense fallback={<span className="pico-loading">Pico</span>}>
            <PicoAvatar emotion={emotion} size={76} />
          </Suspense>
        </div>
        <section
          ref={panelRef}
          className="pico-panel"
          aria-label="Pico 助手"
          aria-hidden="true"
        >
          <PicoHeader variant="dock" showClose />
          <PicoConversation variant="dock" active={open} />
        </section>
        <button
          ref={orbRef}
          type="button"
          className="pico-orb-hit"
          aria-label={open ? '收起 Pico 助手' : '打开 Pico 助手'}
          aria-expanded={open}
          title="Pico · 点击打开，拖动可移动"
          onPointerDown={(event) => {
            if (event.button !== 0 || open) return
            const box = event.currentTarget.getBoundingClientRect()
            dragging.current = {
              x: event.clientX,
              y: event.clientY,
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              origin: offset,
            }
            dragged.current = false
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = dragging.current
            if (!drag) return
            const rawX = event.clientX - drag.x
            const rawY = event.clientY - drag.y
            const dx = Math.max(
              8 - drag.left,
              Math.min(innerWidth - drag.width - 8 - drag.left, rawX),
            )
            const dy = Math.max(
              72 - drag.top,
              Math.min(innerHeight - drag.height - 18 - drag.top, rawY),
            )
            if (Math.hypot(rawX, rawY) > 4) dragged.current = true
            if (dragged.current)
              setOffset({ x: drag.origin.x + dx, y: drag.origin.y + dy })
          }}
          onPointerUp={() => {
            dragging.current = undefined
          }}
          onPointerCancel={() => {
            dragging.current = undefined
            dragged.current = true
          }}
          onClick={(event) => {
            const suppress = dragged.current && event.detail !== 0
            dragged.current = false
            if (!suppress) toggle()
          }}
        >
          <span className="pico-orb-hit__label">打开 Pico</span>
        </button>
        {!open && unread && <span className="pico-orb__badge" aria-hidden />}
        {!open && <span className="pico-orb__label">Pico</span>}
      </div>
    </div>
  )
}

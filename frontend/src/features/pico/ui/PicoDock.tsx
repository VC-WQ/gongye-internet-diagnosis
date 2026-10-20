import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { usePico } from '../core/PicoProvider'
const PicoAvatar = lazy(() => import('./PicoAvatar'))
const PicoPanel = lazy(() => import('./PicoPanel'))
import '../pico.css'

export default function PicoDock() {
  const { open, setOpen, toggle, unread, emotion } = usePico()
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 640px)').matches)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const orbRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)
  const dragging = useRef<{ x: number; y: number; left: number; top: number; width: number; height: number; origin: typeof offset }>()
  const dragged = useRef(false)
  useEffect(() => {
    const query = matchMedia('(max-width: 640px)')
    const changed = () => {
      setCompact(query.matches)
      setOffset({ x: 0, y: 0 })
      dragging.current = undefined
      dragged.current = false
    }
    query.addEventListener('change', changed)
    window.addEventListener('resize', changed)
    return () => {
      query.removeEventListener('change', changed)
      window.removeEventListener('resize', changed)
    }
  }, [])
  useEffect(() => {
    let frame = 0
    if (open) setOffset({ x: 0, y: 0 })
    // Only return focus after a real close; mounting the dock must not steal it.
    else if (wasOpen.current) frame = requestAnimationFrame(() => orbRef.current?.focus({ preventScroll: true }))
    wasOpen.current = open
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <div className={`pico-dock ${open ? 'is-open' : ''}`} style={{ transform: open ? undefined : `translate(${offset.x}px,${offset.y}px)` }}>
      {open && <Suspense fallback={<div className="pico-panel pico-loading" role="status">正在打开 Pico…</div>}><PicoPanel /></Suspense>}
      <button
        ref={orbRef}
        type="button"
        className="pico-orb"
        aria-label={open ? '收起 Pico 助手' : '打开 Pico 助手'}
        aria-expanded={open}
        title="Pico · 点击打开，拖动可移动"
        onPointerDown={(event) => {
          if (event.button !== 0 || open) return
          const box = event.currentTarget.getBoundingClientRect()
          dragging.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top, width: box.width, height: box.height, origin: offset }
          dragged.current = false
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = dragging.current
          if (!drag) return
          const rawX = event.clientX - drag.x
          const rawY = event.clientY - drag.y
          const dx = Math.max(8 - drag.left, Math.min(innerWidth - drag.width - 8 - drag.left, rawX))
          const dy = Math.max(72 - drag.top, Math.min(innerHeight - drag.height - 18 - drag.top, rawY))
          if (Math.hypot(rawX, rawY) > 4) dragged.current = true
          if (dragged.current) setOffset({ x: drag.origin.x + dx, y: drag.origin.y + dy })
        }}
        onPointerUp={() => { dragging.current = undefined }}
        onPointerCancel={() => { dragging.current = undefined; dragged.current = true }}
        onClick={(event) => {
          // Keyboard activation has detail=0 and must remain available after a canceled drag.
          const suppress = dragged.current && event.detail !== 0
          dragged.current = false
          if (!suppress) toggle()
        }}
      >
        <Suspense fallback={<span className="pico-loading">Pico</span>}><PicoAvatar emotion={emotion} size={open ? 44 : compact ? 48 : 76} /></Suspense>
        {!open && unread && <span className="pico-orb__badge" />}
        <span className="pico-orb__label">Pico</span>
      </button>
    </div>
  )
}

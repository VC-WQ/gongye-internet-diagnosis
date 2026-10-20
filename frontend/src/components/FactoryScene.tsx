import { useEffect, useRef, useState } from 'react'
import { Button, Empty, Space } from 'antd'
import { boundCamera, zoomAt, pinchCamera, type Camera } from '../services/sceneCamera'
import type { Device } from '../services/api'
import { STATUS_META } from './BusinessUI'

function Machine({ type }: { type: string }) {
  return (
    <g className="machine-shape">
      <path
        d="M-67 20 5-18 70 17 0 55Z"
        fill="var(--machine-base)"
        stroke="var(--line)"
        strokeWidth="1.2"
      />
      <path d="M-67 20v9L0 65v-10Z" fill="var(--machine-side)" />
      <path d="M0 55v10L70 27V17Z" fill="var(--machine-front)" />
      {type === 'compressor' ? (
        <>
          <path d="M-47-31 1-56 48-31v55L1 49-47 24Z" fill="var(--machine-front)" />
          <path d="M-47-31 1-6 48-31 1-56Z" fill="var(--machine-top)" />
          <path d="M1-6v55l47-25v-55Z" fill="var(--machine-side)" />
          <path
            d="M-37-13-10 1M-37-4-10 10M-37 5-10 19M12 2 35-10M12 12 35 0M12 22 35 10"
            stroke="var(--machine-detail)"
            strokeWidth="4"
          />
          <path
            d="M-29-41v-20l30-16 28 15v20"
            fill="none"
            stroke="var(--machine-metal)"
            strokeWidth="5"
          />
        </>
      ) : (
        <>
          <path d="M-46-19-4-41 46-14v35L4 44-46 17Z" fill="var(--machine-front)" />
          <ellipse
            cx="-25"
            cy="-3"
            rx="26"
            ry="31"
            fill="var(--machine-top)"
            transform="rotate(-25 -25 -3)"
          />
          <ellipse
            cx="-25"
            cy="-3"
            rx="17"
            ry="22"
            fill="var(--machine-side)"
            transform="rotate(-25 -25 -3)"
          />
          <path
            d="M-5-35 42-10M-4-25 44 0M-3-14 44 10"
            stroke="var(--machine-metal)"
            strokeWidth="3"
          />
          <path d="M4 15v26M19 8v25M33 1v24" stroke="var(--machine-detail)" strokeWidth="4" />
          {type === 'pump' ? (
            <>
              <path
                d="M-31-16v-29L-9-57 6-49v27"
                fill="var(--machine-metal)"
                stroke="var(--machine-top)"
              />
              <ellipse
                cx="-25"
                cy="-3"
                rx="9"
                ry="12"
                fill="var(--machine-metal)"
                transform="rotate(-25 -25 -3)"
              />
            </>
          ) : (
            <>
              <path d="M-18-37v-14L4-63 24-52v14L3-26Z" fill="var(--machine-top)" />
              <path d="M-45 11-63 20" stroke="var(--machine-metal)" strokeWidth="8" />
            </>
          )}
        </>
      )}
    </g>
  )
}
export default function FactoryScene({
  devices,
  selected,
  onSelect,
  onClear,
}: {
  devices: Device[]
  selected?: string
  onSelect: (id: string) => void
  onClear?: () => void
}) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const current = useRef(camera)
  const target = useRef(camera)
  const velocity = useRef({ x: 0, y: 0, zoom: 0 })
  const frame = useRef(0)
  const lastTime = useRef(0)
  const reduced = useRef(false)
  const svg = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const moved = useRef(false)
  const dragDistance = useRef(0)
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(devices.length / 6))
  const visiblePage = Math.min(page, pages - 1)
  const visible = devices.slice(visiblePage * 6, visiblePage * 6 + 6)
  const columns = Math.max(2, Math.min(3, visible.length))
  const slots = visible.map((device, index) => ({
    device, x: 180 + (index % columns) * 255,
    y: 210 + Math.floor(index / columns) * 280,
  }))
  const animate = (time: number) => {
    const dt = Math.min((time - (lastTime.current || time - 16)) / 1000, .032)
    lastTime.current = time
    const next = { ...current.current }
    let moving = false
    for (const key of ['x', 'y', 'zoom'] as const) {
      velocity.current[key] += ((target.current[key] - next[key]) * 190 - velocity.current[key] * 27) * dt
      next[key] += velocity.current[key] * dt
      if (Math.abs(target.current[key] - next[key]) > (key === 'zoom' ? .0004 : .08) || Math.abs(velocity.current[key]) > .02) moving = true
    }
    current.current = moving ? next : { ...target.current }
    setCamera(current.current)
    frame.current = moving ? requestAnimationFrame(animate) : 0
    if (!moving) lastTime.current = 0
  }
  const move = (value: Camera, immediate = false) => {
    target.current = boundCamera(value)
    if (immediate || reduced.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      lastTime.current = 0
      velocity.current = { x: 0, y: 0, zoom: 0 }
      current.current = target.current
      setCamera(target.current)
    } else if (!frame.current) frame.current = requestAnimationFrame(animate)
  }
  const reset = () => move({ x: 0, y: 0, zoom: 1 })
  const localPoint = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return { x: 450, y: 330 }
    const point = new DOMPoint(x, y).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }
  const zoom = (factor: number, point = { x: 450, y: 330 }) => move(zoomAt(target.current, factor, point))
  const focus = (slot: typeof slots[number]) => {
    move({ x: (450 - slot.x) * 1.3, y: (330 - slot.y) * 1.3, zoom: 1.3 })
    onSelect(slot.device.id)
  }
  useEffect(() => {
    const index = devices.findIndex((d) => d.id === selected)
    if (index >= 0) setPage(Math.floor(index / 6))
  }, [selected, devices.map((d) => d.id).join('|')])
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => { reduced.current = media.matches }
    changed()
    media.addEventListener('change', changed)
    return () => { media.removeEventListener('change', changed); cancelAnimationFrame(frame.current) }
  }, [])
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * unit * .008), localPoint(e.clientX, e.clientY))
      else {
        const p = localPoint(e.clientX, e.clientY)
        const q = localPoint(e.clientX - e.deltaX * unit, e.clientY - e.deltaY * unit)
        move({ ...target.current, x: target.current.x + q.x - p.x, y: target.current.y + q.y - p.y })
      }
    }
    let gestureScale = 1
    const gesture = (event: Event) => {
      event.preventDefault()
      const e = event as Event & { scale: number; clientX: number; clientY: number }
      if (event.type === 'gesturestart') gestureScale = e.scale || 1
      else { zoom(e.scale / gestureScale, localPoint(e.clientX, e.clientY)); gestureScale = e.scale }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('gesturestart', gesture, { passive: false })
    el.addEventListener('gesturechange', gesture, { passive: false })
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('gesturestart', gesture)
      el.removeEventListener('gesturechange', gesture)
    }
  }, [devices.length > 0])

  return (
    <div className="factory-scene">
      {!devices.length ? (
        <Empty description="暂无设备" />
      ) : (
        <svg
          ref={svg}
          viewBox="0 0 900 660"
          className="factory-svg"
          aria-label="设备交互场景，可双指平移、捏合缩放，方向键平移，Home 复位"
          tabIndex={0}
          data-camera={`${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.zoom.toFixed(3)}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); reset(); onClear?.(); return }
            if ((e.target as Element).closest('[data-device]')) return
            const steps: Record<string, [number, number]> = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }
            if (steps[e.key]) { e.preventDefault(); const [x, y] = steps[e.key]; move({ ...target.current, x: target.current.x + x, y: target.current.y + y }) }
            if (e.key === 'Home') { e.preventDefault(); reset() }
            if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.15) }
            if (e.key === '-') { e.preventDefault(); zoom(1 / 1.15) }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as Element).closest('[data-device]')) return
            if (pointers.current.size === 0) { moved.current = false; dragDistance.current = 0 }
            else moved.current = true
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const old = pointers.current.get(e.pointerId)
            if (!old) return
            const next = { x: e.clientX, y: e.clientY }
            const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1]
            const p = localPoint(old.x, old.y), q = localPoint(next.x, next.y)
            dragDistance.current += Math.hypot(next.x - old.x, next.y - old.y)
            if (dragDistance.current > 3) moved.current = true
            if (other) {
              const anchor = localPoint(other.x, other.y)
              move(pinchCamera(target.current, [p, anchor], [q, anchor]), true)
            } else {
              move({ ...target.current, x: target.current.x + q.x - p.x, y: target.current.y + q.y - p.y }, true)
            }
            pointers.current.set(e.pointerId, next)
          }}
          onPointerUp={(e) => {
            if (!pointers.current.has(e.pointerId)) return
            pointers.current.delete(e.pointerId)
            if (!moved.current && pointers.current.size === 0) { reset(); onClear?.() }
          }}
          onPointerCancel={(e) => { pointers.current.delete(e.pointerId); moved.current = true }}
        >
          <defs>
            <pattern
              id="factory-grid"
              width="48"
              height="48"
              patternUnits="userSpaceOnUse"
              patternTransform="matrix(1 .5 -1 .5 450 90)"
            >
              <path
                d="M48 0H0V48"
                fill="none"
                stroke="var(--scene-grid)"
                strokeWidth="1"
              />
            </pattern>
            <radialGradient id="factory-ground">
              <stop stopColor="var(--scene-ground)" stopOpacity=".65" />
              <stop offset="1" stopColor="var(--surface)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            cx="450"
            cy="365"
            rx="425"
            ry="280"
            fill="url(#factory-ground)"
          />
          <g
            transform={`translate(${450 + camera.x} ${330 + camera.y}) scale(${camera.zoom}) translate(-450 -330)`}
          >
            <path
              d="M30 300 450 80 870 300 450 540Z"
              fill="url(#factory-grid)"
              stroke="var(--line)"
            />
            <path
              d="M30 300v20l420 220 420-220v-20M450 540v20"
              fill="none"
              stroke="var(--line)"
            />
            {slots.map(({ device, x, y }) => {
              const chosen = device.id === selected
              const color = STATUS_META[device.status]?.hex ?? '#7d8997'
              return (
                <g
                  key={device.id}
                  data-device={device.id}
                  transform={`translate(${x} ${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${device.name}，${STATUS_META[device.status]?.label ?? device.status}`}
                  aria-pressed={chosen}
                  className={`factory-node ${chosen ? 'is-selected' : ''}`}
                  onClick={() => focus({ device, x, y })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      focus({ device, x, y })
                    }
                  }}
                >
                  <title>
                    {device.name} · {device.id}
                  </title>
                  <path
                    className="node-platform"
                    d="M-103 19 0-35 103 19 0 74Z"
                    fill={chosen ? 'var(--brand-soft)' : 'var(--surface-muted)'}
                    stroke={chosen ? 'var(--brand)' : 'var(--line)'}
                    strokeWidth={chosen ? 2 : 1}
                  />
                  <ellipse
                    cx="0"
                    cy="28"
                    rx="64"
                    ry="17"
                    fill="var(--machine-shadow)"
                    opacity=".6"
                  />
                  <Machine type={device.device_type} />
                  <path
                    d="M-103 19 0 74 103 19"
                    fill="none"
                    stroke={chosen ? 'var(--brand)' : 'var(--line)'}
                    strokeWidth="2"
                  />
                  <g transform="translate(0 111)">
                    <rect
                      x="-95"
                      y="-16"
                      width="190"
                      height="40"
                      rx="0"
                      fill={chosen ? 'var(--surface-raised)' : 'var(--surface)'}
                      stroke={chosen ? 'var(--brand)' : 'var(--line)'}
                    />
                    <circle cx="-78" cy="3" r="4" fill={color} />
                    <text
                      x="-65"
                      y="8"
                      fill="var(--text)"
                      fontSize="15"
                      fontWeight="500"
                    >
                      {Array.from(device.name).length > 8
                        ? Array.from(device.name).slice(0, 7).join('') + '…'
                        : device.name}
                    </text>
                  </g>
                </g>
              )
            })}
          </g>
        </svg>
      )}
      <div className="scene-controls">
        {pages > 1 ? (
          <Space size={4}>
            <Button
              size="small"
              aria-label="上一组设备"
              disabled={visiblePage === 0}
              onClick={() => { setPage(visiblePage - 1); reset() }}
            >
              ‹
            </Button>
            <span className="scene-page">
              {visiblePage + 1} / {pages}
            </span>
            <Button
              size="small"
              aria-label="下一组设备"
              disabled={visiblePage === pages - 1}
              onClick={() => { setPage(visiblePage + 1); reset() }}
            >
              ›
            </Button>
          </Space>
        ) : (
          <span className="scene-hint">双指平移 · 捏合缩放</span>
        )}
        <Space.Compact>
          <Button aria-label="缩小场景" onClick={() => zoom(1 / 1.15)}>
            −
          </Button>
          <Button
            aria-label="重置视角"
            onClick={reset}
          >
            {Math.round(camera.zoom * 100)}%
          </Button>
          <Button aria-label="放大场景" onClick={() => zoom(1.15)}>
            ＋
          </Button>
        </Space.Compact>
      </div>
    </div>
  )
}

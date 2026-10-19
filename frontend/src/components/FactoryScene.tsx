import { useEffect, useRef, useState } from 'react'
import { Button, Empty, Space } from 'antd'
import type { Device } from '../services/api'
import { STATUS_META } from './BusinessUI'

type Camera = { x: number; y: number; zoom: number }
function initialCamera(): Camera {
  try {
    const v = JSON.parse(sessionStorage.getItem('factory:camera') ?? 'null')
    if ([v?.x, v?.y, v?.zoom].every(Number.isFinite)) return v
  } catch {
    /* Use initial view. */
  }
  return { x: 0, y: 0, zoom: 1 }
}
function Machine({ type }: { type: string }) {
  return (
    <g className="machine-shape">
      <path
        d="M-67 20 5-18 70 17 0 55Z"
        fill="#435565"
        stroke="#7c8c96"
        strokeWidth="1.2"
      />
      <path d="M-67 20v9L0 65v-10Z" fill="#253746" />
      <path d="M0 55v10L70 27V17Z" fill="#344858" />
      {type === 'compressor' ? (
        <>
          <path d="M-47-31 1-56 48-31v55L1 49-47 24Z" fill="#536b7b" />
          <path d="M-47-31 1-6 48-31 1-56Z" fill="#8d9fa6" />
          <path d="M1-6v55l47-25v-55Z" fill="#3b5263" />
          <path
            d="M-37-13-10 1M-37-4-10 10M-37 5-10 19M12 2 35-10M12 12 35 0M12 22 35 10"
            stroke="#203747"
            strokeWidth="4"
          />
          <path
            d="M-29-41v-20l30-16 28 15v20"
            fill="none"
            stroke="#acb9be"
            strokeWidth="5"
          />
        </>
      ) : (
        <>
          <path d="M-46-19-4-41 46-14v35L4 44-46 17Z" fill="#5d7888" />
          <ellipse
            cx="-25"
            cy="-3"
            rx="26"
            ry="31"
            fill="#95a6ab"
            transform="rotate(-25 -25 -3)"
          />
          <ellipse
            cx="-25"
            cy="-3"
            rx="17"
            ry="22"
            fill="#405c6c"
            transform="rotate(-25 -25 -3)"
          />
          <path
            d="M-5-35 42-10M-4-25 44 0M-3-14 44 10"
            stroke="#a0b2b8"
            strokeWidth="3"
          />
          <path d="M4 15v26M19 8v25M33 1v24" stroke="#344f60" strokeWidth="4" />
          {type === 'pump' ? (
            <>
              <path
                d="M-31-16v-29L-9-57 6-49v27"
                fill="#a4b4b6"
                stroke="#c2ccca"
              />
              <ellipse
                cx="-25"
                cy="-3"
                rx="9"
                ry="12"
                fill="#c0cbcb"
                transform="rotate(-25 -25 -3)"
              />
            </>
          ) : (
            <>
              <path d="M-18-37v-14L4-63 24-52v14L3-26Z" fill="#9aaaae" />
              <path d="M-45 11-63 20" stroke="#b7c2c3" strokeWidth="8" />
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
}: {
  devices: Device[]
  selected?: string
  onSelect: (id: string) => void
}) {
  const [camera, setCamera] = useState(initialCamera)
  const drag = useRef<{
    x: number
    y: number
    startX: number
    startY: number
  }>()
  const svg = useRef<SVGSVGElement>(null)
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(devices.length / 6))
  const visiblePage = Math.min(page, pages - 1)
  useEffect(() => {
    const index = devices.findIndex((device) => device.id === selected)
    if (index >= 0) setPage(Math.floor(index / 6))
  }, [selected, devices.map((d) => d.id).join('|')])
  const visible = devices.slice(visiblePage * 6, visiblePage * 6 + 6)
  const columns = Math.max(2, Math.min(3, visible.length))
  const slots = visible.map((device, index) => ({
    device,
    x: 180 + (index % columns) * 255,
    y: 210 + Math.floor(index / columns) * 280,
  }))
  const move = (value: Camera) => {
    setCamera(value)
    sessionStorage.setItem('factory:camera', JSON.stringify(value))
  }
  const zoom = (delta: number) =>
    move({ ...camera, zoom: Math.max(0.6, Math.min(1.8, camera.zoom + delta)) })
  const focus = () => {
    const index = devices.findIndex((device) => device.id === selected)
    if (index < 0) return
    setPage(Math.floor(index / 6))
    const slot = index % 6
    const x = 180 + (slot % 3) * 255
    const y = 210 + Math.floor(slot / 3) * 280
    move({ x: (435 - x) * 1.25, y: (310 - y) * 1.25, zoom: 1.25 })
  }

  return (
    <div className="factory-scene">
      <div className="scene-caption">
        <span>设备分组示意</span>
        <span>按目录排列 · 非工厂平面</span>
      </div>
      {!devices.length ? (
        <Empty description="暂无设备" />
      ) : (
        <svg
          ref={svg}
          viewBox="0 0 900 660"
          className="factory-svg"
          aria-label="设备分组交互场景，可拖动视角"
          onPointerDown={(event) => {
            if ((event.target as Element).closest('[data-device]')) return
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              startX: camera.x,
              startY: camera.y,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (!drag.current) return
            const ratio = 900 / (svg.current?.clientWidth || 900)
            move({
              ...camera,
              x: drag.current.startX + (event.clientX - drag.current.x) * ratio,
              y: drag.current.startY + (event.clientY - drag.current.y) * ratio,
            })
          }}
          onPointerUp={() => {
            drag.current = undefined
          }}
          onPointerCancel={() => {
            drag.current = undefined
          }}
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
                stroke="#263b4b"
                strokeWidth="1"
              />
            </pattern>
            <radialGradient id="factory-ground">
              <stop stopColor="#253d4a" stopOpacity=".65" />
              <stop offset="1" stopColor="#15232e" stopOpacity="0" />
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
              stroke="#304653"
            />
            <path
              d="M30 300v20l420 220 420-220v-20M450 540v20"
              fill="none"
              stroke="#304653"
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
                  onClick={() => onSelect(device.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(device.id)
                    }
                  }}
                >
                  <title>
                    {device.name} · {device.id}
                  </title>
                  <path
                    className="node-platform"
                    d="M-103 19 0-35 103 19 0 74Z"
                    fill={chosen ? '#304b56' : '#1d303d'}
                    stroke={chosen ? '#9dc8c1' : '#3b5160'}
                    strokeWidth={chosen ? 2 : 1}
                  />
                  <ellipse
                    cx="0"
                    cy="28"
                    rx="64"
                    ry="17"
                    fill="#0b1821"
                    opacity=".6"
                  />
                  <Machine type={device.device_type} />
                  <path
                    d="M-103 19 0 74 103 19"
                    fill="none"
                    stroke={chosen ? '#9dc8c1' : '#405766'}
                    strokeWidth="2"
                  />
                  <g transform="translate(0 111)">
                    <rect
                      x="-95"
                      y="-16"
                      width="190"
                      height="52"
                      rx="5"
                      fill={chosen ? '#293f4b' : '#172a37'}
                      stroke={chosen ? '#6c938f' : '#314654'}
                    />
                    <circle cx="-77" cy="1" r="4" fill={color} />
                    <text
                      x="-64"
                      y="6"
                      fill="#e3e9ed"
                      fontSize="15"
                      fontWeight="500"
                    >
                      {Array.from(device.name).length > 7
                        ? Array.from(device.name).slice(0, 6).join('') + '…'
                        : device.name}
                    </text>
                    <text x="-64" y="25" fill="#9aabb7" fontSize="10">
                      {device.id}
                    </text>
                    <text
                      x="78"
                      y="7"
                      textAnchor="end"
                      fill={color}
                      fontSize="11"
                    >
                      {STATUS_META[device.status]?.label ?? '未知'}
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
              onClick={() => setPage(visiblePage - 1)}
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
              onClick={() => setPage(visiblePage + 1)}
            >
              ›
            </Button>
          </Space>
        ) : (
          <span>拖动场景调整视角</span>
        )}
        <Space.Compact>
          <Button aria-label="缩小场景" onClick={() => zoom(-0.15)}>
            −
          </Button>
          <Button
            aria-label="重置视角"
            onClick={() => move({ x: 0, y: 0, zoom: 1 })}
          >
            {Math.round(camera.zoom * 100)}%
          </Button>
          <Button aria-label="放大场景" onClick={() => zoom(0.15)}>
            ＋
          </Button>
        </Space.Compact>
        <Button disabled={!selected} onClick={focus}>
          聚焦设备
        </Button>
      </div>
    </div>
  )
}

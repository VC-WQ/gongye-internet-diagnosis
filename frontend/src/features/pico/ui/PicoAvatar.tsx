import { useEffect, useRef } from 'react'
import type { PicoEmotion } from '../core/types'

const TALK_SYMBOLS = ['Q', 'O', 'P', 'D', 'B', 'R', '@', '&']
const SEARCH_SYMBOLS = ['#', '%', '&', '*', '+', '=', '?', '!', '0', '1', '<', '>', '/', '\\']

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function stroke(ctx: CanvasRenderingContext2D, width: number) {
  ctx.strokeStyle = '#8ef0ff'
  ctx.lineWidth = Math.max(1.5, width)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(126, 227, 255, 0.85)'
  ctx.shadowBlur = Math.max(3, width * 2)
}

function drawChevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  alpha = 1,
) {
  ctx.save()
  ctx.globalAlpha = alpha
  stroke(ctx, size * 0.13)
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.22, cy - size * 0.32)
  ctx.lineTo(cx + size * 0.16, cy)
  ctx.lineTo(cx - size * 0.22, cy + size * 0.32)
  ctx.stroke()
  ctx.restore()
}

function drawUnderscore(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  scale = 1,
) {
  ctx.save()
  stroke(ctx, size * 0.13)
  const width = size * 0.48 * scale
  ctx.beginPath()
  ctx.moveTo(cx - width / 2, cy + size * 0.22)
  ctx.lineTo(cx + width / 2, cy + size * 0.22)
  ctx.stroke()
  ctx.restore()
}

function drawQuestion(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.save()
  stroke(ctx, size * 0.12)
  ctx.beginPath()
  ctx.arc(cx, cy - size * 0.12, size * 0.24, Math.PI * 0.95, Math.PI * 2.15)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + size * 0.2, cy + size * 0.02)
  ctx.lineTo(cx, cy + size * 0.22)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy + size * 0.42, size * 0.06, 0, Math.PI * 2)
  ctx.fillStyle = '#8ef0ff'
  ctx.fill()
  ctx.restore()
}

function drawExclamation(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.save()
  stroke(ctx, size * 0.13)
  ctx.beginPath()
  ctx.moveTo(cx, cy - size * 0.38)
  ctx.lineTo(cx, cy + size * 0.16)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy + size * 0.4, size * 0.06, 0, Math.PI * 2)
  ctx.fillStyle = '#8ef0ff'
  ctx.fill()
  ctx.restore()
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  count: number,
) {
  ctx.save()
  ctx.fillStyle = '#8ef0ff'
  ctx.shadowColor = 'rgba(126, 227, 255, 0.85)'
  ctx.shadowBlur = 6
  for (let index = 0; index < count; index += 1) {
    ctx.beginPath()
    ctx.arc(
      cx + (index - (count - 1) / 2) * size * 0.28,
      cy + size * 0.2,
      size * 0.075,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  ctx.restore()
}

function drawColon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.save()
  ctx.fillStyle = '#8ef0ff'
  ctx.shadowColor = 'rgba(126, 227, 255, 0.85)'
  ctx.shadowBlur = 6
  for (const offset of [-0.18, 0.18]) {
    ctx.beginPath()
    ctx.arc(cx, cy + size * offset, size * 0.068, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawD(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.save()
  stroke(ctx, size * 0.12)
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.2, cy - size * 0.34)
  ctx.lineTo(cx - size * 0.2, cy + size * 0.34)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx - size * 0.2, cy, size * 0.34, -Math.PI / 2, Math.PI / 2)
  ctx.stroke()
  ctx.restore()
}

function drawTextSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: string,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.save()
  ctx.fillStyle = '#8ef0ff'
  ctx.font = `600 ${size}px "JetBrains Mono", ui-monospace, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(126, 227, 255, 0.85)'
  ctx.shadowBlur = Math.max(4, size * 0.16)
  ctx.fillText(symbol, cx, cy)
  ctx.restore()
}

function drawSearchRows(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  tick: number,
) {
  ctx.save()
  ctx.fillStyle = '#8ef0ff'
  ctx.font = `500 ${size * 0.26}px "JetBrains Mono", ui-monospace, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(126, 227, 255, 0.7)'
  ctx.shadowBlur = 4
  for (let row = 0; row < 2; row += 1) {
    let text = ''
    for (let col = 0; col < 5; col += 1) {
      const index = (tick * 7 + row * 13 + col * 5) % SEARCH_SYMBOLS.length
      text += SEARCH_SYMBOLS[index]
    }
    ctx.globalAlpha = row === 0 ? 0.95 : 0.55
    ctx.fillText(text, cx, cy + (row === 0 ? -size * 0.14 : size * 0.16))
  }
  ctx.restore()
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  emotion: PicoEmotion,
  width: number,
  height: number,
  tick: number,
) {
  const plateWidth = width * 0.54
  const plateHeight = height * 0.23
  const plateX = (width - plateWidth) / 2
  const plateY = height * 0.39

  ctx.save()
  ctx.shadowColor = 'rgba(80, 200, 235, 0.28)'
  ctx.shadowBlur = width * 0.08
  roundRect(ctx, plateX, plateY, plateWidth, plateHeight, width * 0.07)
  ctx.fillStyle = 'rgba(8, 20, 29, 0.86)'
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(142, 240, 255, 0.18)'
  ctx.lineWidth = Math.max(1, width * 0.006)
  ctx.stroke()
  ctx.restore()

  const leftX = width * 0.4
  const rightX = width * 0.61
  const centerY = height * 0.505
  const glyph = width * 0.16

  switch (emotion) {
    case 'thinking':
      drawChevron(ctx, leftX, centerY, glyph)
      drawDots(ctx, rightX + glyph * 0.05, centerY - glyph * 0.18, glyph, 1 + (tick % 3))
      break
    case 'search':
      drawSearchRows(ctx, width / 2, centerY, width, tick)
      break
    case 'talking':
      drawChevron(ctx, leftX, centerY, glyph, 0.95)
      drawTextSymbol(
        ctx,
        TALK_SYMBOLS[tick % TALK_SYMBOLS.length],
        rightX,
        centerY - glyph * 0.04,
        glyph * 1.05,
      )
      break
    case 'happy':
      drawColon(ctx, leftX, centerY, glyph)
      drawD(ctx, rightX, centerY, glyph)
      break
    case 'alert':
      drawChevron(ctx, leftX, centerY, glyph)
      drawExclamation(ctx, rightX, centerY, glyph)
      break
    case 'confused':
      drawChevron(ctx, leftX, centerY, glyph, 0.75)
      drawQuestion(ctx, rightX, centerY, glyph)
      break
    case 'curious':
      drawChevron(ctx, leftX, centerY, glyph)
      drawQuestion(ctx, rightX, centerY, glyph)
      break
    case 'idle':
    default: {
      const blink = (tick % 24) < 2 ? 0.35 : 1
      drawChevron(ctx, leftX, centerY, glyph)
      drawUnderscore(ctx, rightX, centerY, glyph, blink)
      break
    }
  }
}

function draw(
  canvas: HTMLCanvasElement,
  emotion: PicoEmotion,
  tick: number,
  reduced: boolean,
  size: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const width = size
  const height = size
  ctx.clearRect(0, 0, width, height)

  const time = reduced ? 0 : tick
  const breathe = 1 + Math.sin(time / 26) * 0.012
  const bounce =
    emotion === 'happy' && !reduced ? Math.max(0, Math.sin(time / 7)) * -0.01 : 0

  ctx.save()
  ctx.translate(width / 2, height / 2 + height * bounce)
  ctx.scale(1, breathe)
  ctx.translate(-width / 2, -height / 2)

  const halo = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    width * 0.18,
    width * 0.5,
    height * 0.5,
    width * 0.52,
  )
  halo.addColorStop(0, 'rgba(125, 227, 255, 0.42)')
  halo.addColorStop(1, 'rgba(125, 227, 255, 0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, width * 0.5, 0, Math.PI * 2)
  ctx.fill()

  const sphere = ctx.createRadialGradient(
    width * 0.36,
    height * 0.28,
    width * 0.04,
    width * 0.5,
    height * 0.52,
    width * 0.46,
  )
  sphere.addColorStop(0, '#f4fbff')
  sphere.addColorStop(0.45, '#c3e6f6')
  sphere.addColorStop(1, '#6b9fbd')
  ctx.fillStyle = sphere
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, width * 0.43, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.translate(width * 0.37, height * 0.29)
  ctx.rotate(-0.42)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(0, 0, width * 0.15, height * 0.075, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  drawFace(ctx, emotion, width, height, tick)
  ctx.restore()
}

export default function PicoAvatar({
  emotion,
  size = 84,
}: {
  emotion: PicoEmotion
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`

    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(dpr, dpr)

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animated = ['idle', 'thinking', 'talking', 'search', 'happy'].includes(
      emotion,
    )
    let frame = 0
    let tick = 0

    const render = () => {
      const scaled = canvas
      const context = scaled.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(scaled, emotion, tick, reduced, size)
    }

    render()
    if (!animated || reduced) {
      return () => cancelAnimationFrame(frame)
    }

    let last = 0
    const interval = emotion === 'search' || emotion === 'talking' ? 150 : 180
    const loop = (now: number) => {
      if (now - last >= interval) {
        last = now
        tick += 1
        render()
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [emotion, size])

  return (
    <span
      className={`pico-avatar pico-avatar--${emotion}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Pico ${emotion}`}
    >
      <canvas ref={canvasRef} aria-hidden />
    </span>
  )
}

import { useEffect, useState } from 'react'
import type { PicoEmotion } from '../core/types'

const TALK_SYMBOLS = ['Q', 'O', 'P', 'D', 'B', 'R', '@', '&']

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

function faceFor(emotion: PicoEmotion, tick: number, reduced: boolean) {
  switch (emotion) {
    case 'curious':
      return ['>', '?'] as const
    case 'thinking':
      return ['>', reduced ? '...' : '.'.repeat((tick % 3) + 1)] as const
    case 'talking':
      return [
        '>',
        reduced ? 'Q' : TALK_SYMBOLS[tick % TALK_SYMBOLS.length],
      ] as const
    case 'happy':
      return [':', 'D'] as const
    case 'alert':
      return ['>', '!'] as const
    case 'confused':
      return ['>', '?'] as const
    case 'idle':
    default:
      return ['>', '_'] as const
  }
}

export default function PicoAvatar({
  emotion,
  size = 84,
}: {
  emotion: PicoEmotion
  size?: number
}) {
  const reduced = usePrefersReducedMotion()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (reduced) return
    if (emotion !== 'thinking' && emotion !== 'talking') return
    const interval = window.setInterval(
      () => setTick((value) => value + 1),
      emotion === 'talking' ? 180 : 420,
    )
    return () => window.clearInterval(interval)
  }, [emotion, reduced])

  const [left, right] = faceFor(emotion, tick, reduced)

  return (
    <span
      className={`pico-avatar pico-avatar--${emotion}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Pico ${emotion}`}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        <defs>
          <radialGradient id="pico-sphere" cx="38%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#f2fbff" />
            <stop offset="46%" stopColor="#bfe3f4" />
            <stop offset="100%" stopColor="#6b9fbd" />
          </radialGradient>
          <radialGradient id="pico-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7de3ff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#7de3ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="47" fill="url(#pico-glow)" />
        <circle cx="50" cy="50" r="42" fill="url(#pico-sphere)" />
        <ellipse
          cx="38"
          cy="30"
          rx="15"
          ry="9"
          fill="#ffffff"
          opacity="0.55"
          transform="rotate(-24 38 30)"
        />
        <rect
          x="25"
          y="40"
          width="50"
          height="22"
          rx="6"
          fill="#0d1b26"
          opacity="0.82"
        />
        <text
          x="34"
          y="57"
          textAnchor="middle"
          className="pico-face-glyph"
          fontSize="19"
        >
          {left}
        </text>
        <text
          x="62"
          y="57"
          textAnchor="middle"
          className="pico-face-glyph"
          fontSize="19"
        >
          {right}
        </text>
      </svg>
    </span>
  )
}

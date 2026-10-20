/** V2.2 全站运动令牌：单一来源，禁止在组件里散落魔法时长。 */
export const DURATION = {
  hover: 0.18,
  selection: 0.3,
  flip: 0.22,
  content: 0.32,
  panel: 0.48,
  route: 0.42,
  camera: 0.72,
  loginReveal: 1.1,
  loginSuccess: 1.15,
} as const

export const EASING = {
  outward: [0.16, 1, 0.3, 1],
  balanced: [0.22, 0.61, 0.36, 1],
  anticipation: [0.36, 0, 0.66, 1],
  exit: [0.4, 0, 0.2, 1],
} as const

export const EASE_CSS = {
  outward: 'cubic-bezier(0.16, 1, 0.30, 1)',
  balanced: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  anticipation: 'cubic-bezier(0.36, 0, 0.66, 1)',
  exit: 'cubic-bezier(0.40, 0, 0.20, 1)',
} as const

export const SPRING = {
  small: { stiffness: 420, damping: 38, mass: 0.9 },
  panel: { stiffness: 260, damping: 32, mass: 1 },
  scene: { stiffness: 250, damping: 36, mass: 1.2 },
} as const

export const DURATION_MS = Object.fromEntries(
  Object.entries(DURATION).map(([key, value]) => [key, Math.round(value * 1000)]),
) as Record<keyof typeof DURATION, number>

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

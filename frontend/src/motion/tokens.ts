/** Semantic families use milliseconds; geometry retains distance-dependent travel. */
const sceneTravel = { min: 180, max: 800, worldUnitsPerMs: 0.85 } as const
export const MOTION = {
  mechanicalText: { duration: 220 },
  mechanicalContent: { duration: 320 },
  rowPresence: { duration: 180 },
  tableReflow: { duration: 260 },
  routeModule: { exit: 170, enter: 330, stagger: 24 },
  sceneExit: sceneTravel,
  sceneReflow: sceneTravel,
  researchReveal: { duration: 520 },
  researchTitle: { duration: 460 },
  researchChart: { update: 240 },
  logoutReturn: { duration: 980 },
} as const

/** Compatibility durations are in seconds; all new callers use semantic families. */
export const DURATION = {
  hover: 0.18,
  selection: 0.3,
  flip: MOTION.mechanicalText.duration / 1000,
  content: MOTION.mechanicalContent.duration / 1000,
  panel: 0.42,
  route: 0.42,
  camera: 0.72,
  loginReveal: 1.1,
  loginSuccess: 1.05,
  logoutReturn: MOTION.logoutReturn.duration / 1000,
  picoMorph: 0.42,
  picoReveal: 0.38,
  messageFlight: 0.42,
  messageAnswer: 0.46,
} as const

export const LOGIN_SEQUENCE = {
  panelPrepare: 55,
  panelEnd: 350,
  redEarliestStart: 65,
  redEnd: 620,
  waitingNotice: 1500,
  waitingHelp: 8000,
} as const

/** C has its own return choreography; it never samples B backwards. */
export const LOGOUT_SEQUENCE = {
  paperEnd: 300,
  redStart: 150,
  redEnd: 650,
  panelStart: 460,
} as const

/** Spatial origins belong to the surrounding layout, never to random cards. */
export const FACTORY_ENTRANCE = {
  status: { start: 0, duration: 420, x: 0, y: -12 },
  devices: { start: 100, duration: 550, x: -24, y: 0 },
  scene: { start: 150, duration: 760, x: 0, y: 18 },
  current: { start: 260, duration: 570, x: 24, y: 0 },
  monitor: { start: 320, duration: 580, x: -16, y: 14 },
  events: { start: 380, duration: 620, x: 18, y: 14 },
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

import type { PicoEmotion } from '../core/types'

export const PICO_EMOTIONS: PicoEmotion[] = [
  'idle', 'curious', 'thinking', 'search', 'talking', 'happy', 'alert', 'confused',
]
export const TALK_SYMBOLS = ['Q', 'O', 'P', 'D', 'B', 'R', '@', '&'] as const
export type PicoGesture = 'attention' | 'open' | 'close' | 'context' | 'message' | 'answer' | 'voice-start' | 'voice-pause' | 'voice-end' | 'notification'
export interface PicoReaction { id: number; kind: PicoGesture }
export type MicroActionKind = 'rest' | 'look-left' | 'look-right' | 'look-up' | 'look-down' | 'tilt' | 'nod' | 'double-blink' | 'lean' | PicoGesture
export interface Spring { value: number; velocity: number }
interface MicroAction {
  kind: MicroActionKind; start: number; duration: number
  yaw: number; pitch: number; roll: number; bob: number; squash: number
  gazeX: number; gazeY: number; lean: number
}
const AUTONOMOUS = ['look-left', 'look-right', 'look-up', 'look-down', 'tilt', 'nod', 'double-blink', 'lean'] as const


/** Exact underdamped solution. Retargeting preserves both position and velocity. */
export function springTo(s: Spring, target: number, dt: number, frequency = 13, damping = 0.78): number {
  const step = Math.max(0, Math.min(dt, 0.064))
  const w = frequency * Math.sqrt(1 - damping * damping)
  const offset = s.value - target
  const b = (s.velocity + damping * frequency * offset) / w
  const decay = Math.exp(-damping * frequency * step)
  const cosine = Math.cos(w * step)
  const sine = Math.sin(w * step)
  const position = offset * cosine + b * sine
  s.value = target + decay * position
  s.velocity = decay * (-damping * frequency * position + w * (-offset * sine + b * cosine))
  return s.value
}

export function smooth(value: number): number {
  const x = Math.max(0, Math.min(1, value))
  return x * x * (3 - 2 * x)
}

/** Close, briefly hold, then reopen, continuously across phase boundaries. */
export function blinkAmount(elapsed: number): number {
  if (elapsed < 0 || elapsed > 0.36) return 0
  if (elapsed < 0.12) return smooth(elapsed / 0.12)
  if (elapsed < 0.17) return 1
  return 1 - smooth((elapsed - 0.17) / 0.19)
}

export function chevronPoints(blink: number): [number, number][] {
  const b = Math.max(0, Math.min(1, blink))
  return [[-26 - 8 * b, -35 * (1 - b)], [26 * (1 - b), 0], [-26 + 60 * b, 35 * (1 - b)]]
}

/** >_ → >- → —_: the right stroke rises during closing, then settles at full closure. */
export function idleLineY(blink: number, time: number, reduced: boolean): number {
  return 148 - Math.sin(Math.PI * blink) * 20 + (reduced ? 0 : Math.sin(time * 0.8) * 4 * (1 - blink))
}

export interface PicoFrame {
  time: number
  weights: Record<PicoEmotion, number>
  blink: number
  yaw: number
  pitch: number
  roll: number
  bob: number
  squash: number
  wobble: number
  mouthFrom: string
  mouthTo: string
  mouthMix: number
  dots: number[]
  curiousMix: number
  gazeX: number
  gazeY: number
  lean: number
  action: MicroActionKind
  actionProgress: number
  reduced: boolean
}

const POSE: Record<PicoEmotion, { yaw: number; pitch: number; roll: number; squash: number }> = {
  idle: { yaw: 0, pitch: 0, roll: 0, squash: 0 },
  curious: { yaw: 0.17, pitch: -0.08, roll: -0.11, squash: 0.035 },
  thinking: { yaw: -0.11, pitch: 0.09, roll: 0.055, squash: -0.025 },
  search: { yaw: 0, pitch: -0.025, roll: 0, squash: -0.04 },
  talking: { yaw: 0.04, pitch: -0.035, roll: 0, squash: 0.025 },
  happy: { yaw: 0.08, pitch: -0.08, roll: -0.08, squash: 0.075 },
  alert: { yaw: 0, pitch: -0.06, roll: 0.025, squash: 0.085 },
  confused: { yaw: -0.18, pitch: 0.03, roll: 0.12, squash: -0.025 },
}

function seeded(seed: number) {
  let state = seed >>> 0
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000 }
}

export class PicoController {
  private random: () => number
  private time = 0
  private emotion: PicoEmotion = 'idle'
  private weights = Object.fromEntries(PICO_EMOTIONS.map((e) => [e, {
    value: e === 'idle' ? 1 : 0, velocity: 0,
  }])) as Record<PicoEmotion, Spring>
  private pose = {
    yaw: { value: 0, velocity: 0 }, pitch: { value: 0, velocity: 0 },
    roll: { value: 0, velocity: 0 }, bob: { value: 0, velocity: 0 },
    squash: { value: 0, velocity: 0 }, wobble: { value: 0, velocity: 0 },
    gazeX: { value: 0, velocity: 0 }, gazeY: { value: 0, velocity: 0 }, lean: { value: 0, velocity: 0 },
  }
  private nextBlink: number
  private blinkStart = -10
  private secondBlink = -10
  private nextAction: number
  private action: MicroAction | null = null
  private actionBag: (typeof AUTONOMOUS)[number][] = []
  private mouthStart = 0
  private mouthDuration = 0.25
  private mouthFrom = 'O'
  private mouthTo = 'Q'
  constructor(seed = 21) {
    this.random = seeded(seed)
    this.nextBlink = 1.7 + this.random() * 1.4
    this.nextAction = 1.2 + this.random() * 1.2
  }
  setEmotion(emotion: PicoEmotion): void { this.emotion = emotion }

  private startAction(kind: MicroActionKind): void {
    const action: MicroAction = {
      kind, start: this.time, duration: 1.15 + this.random() * .5,
      yaw: 0, pitch: 0, roll: 0, bob: 0, squash: 0, gazeX: 0, gazeY: 0, lean: 0,
    }
    const direction = this.random() < .5 ? -1 : 1
    switch (kind) {
      case 'look-left': action.yaw = -.12; action.gazeX = -.75; break
      case 'look-right': action.yaw = .12; action.gazeX = .75; break
      case 'look-up': action.pitch = -.095; action.gazeY = -.65; break
      case 'look-down': action.pitch = .085; action.gazeY = .6; break
      case 'tilt': action.roll = .11 * direction; action.gazeX = .3 * direction; break
      case 'nod': action.pitch = .12; action.duration = 1.05; break
      case 'double-blink': this.blinkStart = this.time; this.secondBlink = this.time + .43; action.duration = 1.05; break
      case 'lean': action.lean = .075; action.pitch = -.055; action.bob = .018; action.squash = .022; break
      case 'attention': action.yaw = -.14; action.gazeX = -.7; action.roll = -.08; action.lean = .065; break
      case 'open': action.pitch = -.065; action.lean = .07; action.bob = .035; action.squash = .045; action.duration = 1.35; break
      case 'close': action.pitch = .07; action.gazeY = .2; action.duration = .8; break
      case 'context': action.yaw = -.10; action.gazeX = -.65; action.gazeY = -.15; action.duration = 1.4; break
      case 'message': action.pitch = -.055; action.lean = .08; action.gazeY = -.3; action.squash = .025; break
      case 'answer': action.pitch = .09; action.bob = .025; action.squash = .035; action.duration = 1.1; break
      case 'voice-start': action.lean = .055; action.roll = -.035; action.squash = .035; break
      case 'voice-pause': action.pitch = .05; action.gazeY = .3; action.duration = .9; break
      case 'voice-end': action.pitch = .075; action.duration = .9; break
      case 'notification': action.pitch = -.055; action.lean = .075; action.bob = .025; action.gazeY = -.4; break
    }
    this.action = action
  }
  /** A separate body reaction never invents or changes a business emotion. */
  react(kind: PicoGesture): void {
    // Focus restoration and hit-area movement can generate incidental hover.
    // Let a deliberate open/message/voice reaction finish before that quiet cue.
    if (kind === 'attention' && this.action && this.time < this.action.start + this.action.duration &&
      !(['attention', 'context', ...AUTONOMOUS] as readonly string[]).includes(this.action.kind)) return
    if (kind === 'attention' && this.action?.kind === 'attention' && this.time < this.action.start + .8) return
    this.startAction(kind)
  }
  private autonomousKind(): (typeof AUTONOMOUS)[number] {
    if (!this.actionBag.length) {
      this.actionBag = [...AUTONOMOUS]
      for (let i = this.actionBag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1))
        ;[this.actionBag[i], this.actionBag[j]] = [this.actionBag[j], this.actionBag[i]]
      }
    }
    return this.actionBag.pop()!
  }

  step(delta: number, reduced = false): PicoFrame {
    const dt = Math.max(0, Math.min(delta, 0.064))
    this.time += dt
    const t = this.time
    if (t >= this.nextBlink) {
      this.blinkStart = t
      this.secondBlink = this.random() < .22 ? t + .43 : -10
      this.nextBlink = t + 2.7 + this.random() * 3.6
    }
    if (t - this.mouthStart >= this.mouthDuration) {
      this.mouthFrom = this.mouthTo
      let index = Math.floor(this.random() * TALK_SYMBOLS.length)
      if (TALK_SYMBOLS[index] === this.mouthTo) index = (index + 3) % TALK_SYMBOLS.length
      this.mouthTo = TALK_SYMBOLS[index]
      this.mouthStart = t
      this.mouthDuration = 0.18 + this.random() * 0.19
    }
    if (reduced) {
      this.action = null
      this.nextAction = t + 1.5
    } else if (this.action && t >= this.action.start + this.action.duration) {
      this.action = null
      this.nextAction = t + 1.1 + this.random() * 2.1
    } else if (!this.action && t >= this.nextAction && ['idle', 'curious', 'happy'].includes(this.emotion)) {
      this.startAction(this.autonomousKind())
    }
    const action = this.action
    const actionProgress = action ? Math.min(1, (t - action.start) / action.duration) : 0
    const envelope = action ? smooth(actionProgress / .23) * (1 - smooth((actionProgress - .55) / .45)) : 0
    const nod = action?.kind === 'nod' || action?.kind === 'answer' || action?.kind === 'voice-end'
    const pitchReaction = (action?.pitch ?? 0) * (nod ? Math.sin(actionProgress * Math.PI * 2) : 1)
    const weights = {} as Record<PicoEmotion, number>
    let total = 0
    for (const emotion of PICO_EMOTIONS) {
      const target = emotion === this.emotion ? 1 : 0
      if (reduced) { this.weights[emotion].value = target; this.weights[emotion].velocity = 0 }
      else springTo(this.weights[emotion], target, dt, 14, 0.9)
      weights[emotion] = Math.max(0, this.weights[emotion].value)
      total += weights[emotion]
    }
    for (const emotion of PICO_EMOTIONS) weights[emotion] /= total || 1
    const target = POSE[this.emotion]
    const energy = weights.talking * 0.022 + weights.happy * 0.035 + weights.search * 0.014
    const breath = Math.sin(t * 1.63) * 0.009 + Math.sin(t * 0.61 + 1) * 0.003
    const scale = reduced ? 0 : 1
    if (reduced) {
      for (const spring of Object.values(this.pose)) { spring.value = 0; spring.velocity = 0 }
    }
    const yaw = springTo(this.pose.yaw,
      (target.yaw + Math.sin(t * 0.59) * 0.014 + weights.search * Math.sin(t * 1.1) * 0.13 + (action?.yaw ?? 0) * envelope) * scale, dt, 8)
    const pitch = springTo(this.pose.pitch, (target.pitch + Math.sin(t * 0.83) * 0.012 + pitchReaction * envelope) * scale, dt, 9)
    const roll = springTo(this.pose.roll, (target.roll + Math.sin(t * 0.71) * energy + (action?.roll ?? 0) * envelope) * scale, dt, 9)
    const bob = springTo(this.pose.bob,
      (Math.sin(t * 1.17) * 0.025 + Math.sin(t * 0.41) * 0.009 + weights.happy * Math.sin(t * 3.1) * 0.045 + (action?.bob ?? 0) * envelope) * scale, dt, 8)
    const squash = springTo(this.pose.squash, (target.squash + breath + Math.sin(t * 5.3) * energy + (action?.squash ?? 0) * envelope) * scale, dt, 11)
    const wobble = springTo(this.pose.wobble, (roll * 0.32 + Math.sin(t * 2.7) * energy) * scale, dt, 6, 0.65)
    const gazeX = springTo(this.pose.gazeX, (action?.gazeX ?? 0) * envelope * scale, dt, 11, .88)
    const gazeY = springTo(this.pose.gazeY, (action?.gazeY ?? 0) * envelope * scale, dt, 11, .88)
    const lean = springTo(this.pose.lean, (action?.lean ?? 0) * envelope * scale, dt, 9)
    return {
      time: t, weights, yaw, pitch, roll, bob, squash, wobble, gazeX, gazeY, lean,
      action: action?.kind ?? 'rest', actionProgress,
      blink: reduced ? 0 : Math.max(blinkAmount(t - this.blinkStart), blinkAmount(t - this.secondBlink)),
      mouthFrom: this.mouthFrom, mouthTo: this.mouthTo,
      mouthMix: smooth(Math.min(1, (t - this.mouthStart) / 0.13)),
      dots: [0, 1, 2].map((i) => reduced ? 1 : smooth((Math.sin(t * 2.8 - i * 0.9) + 0.45) / 1.1)),
      curiousMix: reduced ? 0 : (Math.sin(t * 0.95) + 1) / 2,
      reduced,
    }
  }
}

/** Shared by body and face, so local soft deformation cannot detach the display. */
export function deformVertex(x: number, y: number, z: number, pose: Pick<PicoFrame, 'squash' | 'wobble'>): [number, number, number] {
  const stretch = 1 + pose.squash
  const radial = 1 / Math.sqrt(stretch)
  const lobe = pose.wobble * y * z
  return [x * radial + lobe * 0.4, y * stretch + pose.wobble * (x * x - z * z) * 0.24, z * radial + lobe * 0.65]
}

export function faceVertex(u: number, v: number, radius = 1.008): [number, number, number] {
  const longitude = (u - 0.5) * 1.62
  const latitude = (v - 0.5) * 0.69
  return [Math.sin(longitude) * Math.cos(latitude) * radius, Math.sin(latitude) * radius, Math.cos(longitude) * Math.cos(latitude) * radius]
}

/** Inverse-transpose Jacobian of deformVertex; preserves smooth sphere normals
 * without traversing every triangle after each small soft-body change. */
export function deformNormal(x: number, y: number, z: number, nx: number, ny: number, nz: number, pose: Pick<PicoFrame, 'squash' | 'wobble'>): [number, number, number] {
  const a=1/Math.sqrt(1+pose.squash), b=.4*pose.wobble*z, c=.4*pose.wobble*y
  const d=.48*pose.wobble*x, e=1+pose.squash, f=-.48*pose.wobble*z
  const h=.65*pose.wobble*z, i=a+.65*pose.wobble*y
  const ox=(e*i-f*h)*nx-d*i*ny+d*h*nz
  const oy=(c*h-b*i)*nx+a*i*ny-a*h*nz
  const oz=(b*f-c*e)*nx+(c*d-a*f)*ny+(a*e-b*d)*nz
  const length=Math.hypot(ox,oy,oz)||1
  return [ox/length,oy/length,oz/length]
}

/** Preserve wall-clock choreography at low drawing frequency, with stable substeps. */
export function advancePico(controller: PicoController, seconds: number, reduced: boolean): PicoFrame {
  let remaining=Math.max(0,Math.min(.25,seconds)), frame=controller.step(0,reduced)
  while(remaining>1e-8){const dt=Math.min(1/60,remaining);frame=controller.step(dt,reduced);remaining-=dt}
  return frame
}

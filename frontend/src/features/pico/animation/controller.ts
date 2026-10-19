import type { PicoEmotion } from '../core/types'

export const PICO_EMOTIONS: PicoEmotion[] = [
  'idle', 'curious', 'thinking', 'search', 'talking', 'happy', 'alert', 'confused',
]
export const TALK_SYMBOLS = ['Q', 'O', 'P', 'D', 'B', 'R', '@', '&'] as const
export interface Spring { value: number; velocity: number }

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
  }
  private nextBlink: number
  private blinkStart = -10
  private mouthStart = 0
  private mouthDuration = 0.25
  private mouthFrom = 'O'
  private mouthTo = 'Q'
  constructor(seed = 21) { this.random = seeded(seed); this.nextBlink = 1.7 + this.random() * 1.4 }
  setEmotion(emotion: PicoEmotion): void { this.emotion = emotion }

  step(delta: number, reduced = false): PicoFrame {
    const dt = Math.max(0, Math.min(delta, 0.064))
    this.time += dt
    const t = this.time
    if (t >= this.nextBlink) {
      this.blinkStart = t
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
    const yaw = springTo(this.pose.yaw,
      (target.yaw + Math.sin(t * 0.59) * 0.055 + weights.search * Math.sin(t * 1.1) * 0.17) * scale, dt, 8)
    const pitch = springTo(this.pose.pitch, (target.pitch + Math.sin(t * 0.83) * 0.025) * scale, dt, 9)
    const roll = springTo(this.pose.roll, (target.roll + Math.sin(t * 0.71) * energy) * scale, dt, 9)
    const bob = springTo(this.pose.bob,
      (Math.sin(t * 1.17) * 0.025 + Math.sin(t * 0.41) * 0.009 + weights.happy * Math.sin(t * 3.1) * 0.045) * scale, dt, 8)
    const squash = springTo(this.pose.squash, (target.squash + breath + Math.sin(t * 5.3) * energy) * scale, dt, 11)
    const wobble = springTo(this.pose.wobble, (roll * 0.32 + Math.sin(t * 2.7) * energy) * scale, dt, 6, 0.65)
    return {
      time: t, weights, yaw, pitch, roll, bob, squash, wobble,
      blink: reduced ? 0 : blinkAmount(t - this.blinkStart),
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

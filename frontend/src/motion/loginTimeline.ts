import { DURATION, FACTORY_ENTRANCE, LOGIN_SEQUENCE, LOGOUT_SEQUENCE } from './tokens'

export const clamp = (value: number, min = 0, max = 1) =>
  Number.isNaN(value) ? min : Math.min(max, Math.max(min, value))
export function smooth(value: number): number {
  const x = clamp(value)
  return x * x * (3 - 2 * x)
}
const progressAt = (elapsed: number, start: number, duration: number) =>
  clamp((elapsed - start) / duration)
const safeLength = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1

/** One bounded overshoot and a zero-velocity landing, no endless oscillation. */
export function settle(value: number, overshoot = .035, crest = .72): number {
  const p = clamp(value)
  if (p === 0 || p === 1) return p
  return p < crest ? (1 + overshoot) * smooth(p / crest)
    : 1 + overshoot * (1 - smooth((p - crest) / (1 - crest)))
}

/** A has three local clocks: red establishes direction, paper opens, form lands. */
export function sampleA(progress: number) {
  const p = clamp(progress)
  const red = settle(p, .045, .74)
  const paper = settle(progressAt(p, .08, .83), .035, .73)
  const panel = settle(progressAt(p, .19, .81), .065, .76)
  return { progress: p, redX: -red || 0, paperScale: .92 + .08 * paper,
    paperX: .035 * (1 - paper), panelY: 42 * (1 - panel), panelScale: .96 + .04 * panel,
    panelOpacity: smooth(progressAt(p, .19, .5)), done: progress >= 1 }
}

export interface LoginGeometry {
  viewportWidth: number
  /** The brand block's measured right edge, i.e. its actual path out of view. */
  redTravel: number
}

export function createBTimeline(geometry: LoginGeometry) {
  const total = DURATION.loginSuccess * 1000
  const panelStart = 0
  const panelPrepare = LOGIN_SEQUENCE.panelPrepare
  const panelEnd = LOGIN_SEQUENCE.panelEnd
  // smooth(.5) === .5: this is exactly the panel's half-collapse instant.
  const paperStart = panelPrepare + (panelEnd - panelPrepare) / 2
  const paperDuration = total - paperStart
  const viewport = safeLength(geometry.viewportWidth)
  const redTravel = safeLength(geometry.redTravel)
  // Keep the measured short path, but give red enough local time to read as a
  // deliberate movement on narrow layouts rather than a fast linear swipe.
  const ratio = clamp(redTravel / viewport, .1, 1)
  const redDuration = Math.max(285, Math.min(
    500, LOGIN_SEQUENCE.redEnd - LOGIN_SEQUENCE.redEarliestStart,
    paperDuration * ratio * 1.1,
  ))
  const redStart = LOGIN_SEQUENCE.redEnd - redDuration
  return {
    total, panelStart, panelPrepare, panelEnd,
    redStart, redDuration, redEnd: LOGIN_SEQUENCE.redEnd,
    paperStart, paperDuration, paperEnd: total,
    redTravel, paperTravel: viewport,
  }
}

export function createCTimeline(geometry: LoginGeometry) {
  return {
    total: DURATION.logoutReturn * 1000,
    paperStart: 0, paperEnd: LOGOUT_SEQUENCE.paperEnd,
    redStart: LOGOUT_SEQUENCE.redStart, redEnd: LOGOUT_SEQUENCE.redEnd,
    panelStart: LOGOUT_SEQUENCE.panelStart, panelEnd: DURATION.logoutReturn * 1000,
    redTravel: safeLength(geometry.redTravel),
    paperTravel: safeLength(geometry.viewportWidth),
  }
}

/** C restores the brand and then the new, empty login form over neutral paper. */
export function sampleC(elapsed: number, geometry: LoginGeometry) {
  const t = createCTimeline(geometry)
  const paperProgress = settle(progressAt(elapsed, t.paperStart, t.paperEnd - t.paperStart), .025, .76)
  const redProgress = settle(progressAt(elapsed, t.redStart, t.redEnd - t.redStart), .045, .72)
  const panelProgress = settle(progressAt(elapsed, t.panelStart, t.panelEnd - t.panelStart), .055, .74)
  return {
    paperProgress, paperX: 0, paperScale: paperProgress,
    redProgress, redX: -t.redTravel * (1 - redProgress) || 0,
    panelProgress, panelScale: .78 + .22 * panelProgress,
    panelY: 26 * (1 - panelProgress),
    panelOpacity: clamp(panelProgress),
    panelRadius: 50 * clamp(1 - panelProgress),
    paperDone: elapsed >= t.paperEnd,
    redDone: elapsed >= t.redEnd,
    panelDone: elapsed >= t.panelEnd,
    done: elapsed >= t.total,
  }
}

/** Independent local clocks; no object waits for another object's tail. */
export function sampleB(elapsed: number, geometry: LoginGeometry) {
  const timeline = createBTimeline(geometry)
  const prep = smooth(elapsed / timeline.panelPrepare)
  const panelProgress = smooth(progressAt(
    elapsed, timeline.panelPrepare, timeline.panelEnd - timeline.panelPrepare,
  ))
  const redProgress = settle(progressAt(elapsed, timeline.redStart, timeline.redDuration), .035, .75)
  const paperProgress = settle(progressAt(elapsed, timeline.paperStart, timeline.paperDuration), .025, .79)
  return {
    panelProgress,
    panelScale: elapsed <= timeline.panelPrepare
      ? 1 + 0.025 * prep : 1.025 * (1 - panelProgress),
    panelRadius: 50 * smooth(panelProgress / 0.7),
    panelOpacity: 1 - smooth(panelProgress),
    panelY: elapsed <= timeline.panelPrepare ? -4 * prep : -4 + 18 * panelProgress,
    redProgress, redX: -timeline.redTravel * redProgress, redScale: 1 - .06 * Math.sin(Math.PI * clamp(redProgress)),
    paperProgress, paperX: -timeline.paperTravel * paperProgress, paperScale: 1 - .045 * Math.sin(Math.PI * clamp(paperProgress)),
    panelDone: elapsed >= timeline.panelEnd,
    redDone: elapsed >= timeline.redEnd,
    paperDone: elapsed >= timeline.paperEnd,
  }
}

/** Crop the longer axis into a square as the panel becomes a circle. */
export function panelInsets(progress: number, width: number, height: number) {
  const morph = smooth(progress / 0.7)
  return {
    x: width > height ? (width - height) / width * 50 * morph : 0,
    y: height > width ? (height - width) / height * 50 * morph : 0,
  }
}

export type FactoryEntry = keyof typeof FACTORY_ENTRANCE
export function sampleFactoryEntrance(elapsed: number, entry: FactoryEntry) {
  const spec = FACTORY_ENTRANCE[entry]
  const progress = settle(progressAt(elapsed, spec.start, spec.duration), entry === 'scene' ? .065 : .045, entry === 'scene' ? .7 : .76)
  return {
    opacity: clamp(progress),
    x: spec.x * (1 - progress) || 0, y: spec.y * (1 - progress) || 0,
    done: elapsed >= spec.start + spec.duration,
  }
}

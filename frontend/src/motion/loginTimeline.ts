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

/** A moves one intact object; the static brand surface remains underneath. */
export function sampleA(progress: number) {
  const p = smooth(progress)
  return { progress: p, redX: -p || 0, done: progress >= 1 }
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
    paperTravel: safeLength(geometry.viewportWidth) * .12,
  }
}

/** C restores the brand and then the new, empty login form over neutral paper. */
export function sampleC(elapsed: number, geometry: LoginGeometry) {
  const t = createCTimeline(geometry)
  const paperProgress = smooth(progressAt(elapsed, t.paperStart, t.paperEnd - t.paperStart))
  const redProgress = smooth(progressAt(elapsed, t.redStart, t.redEnd - t.redStart))
  const panelProgress = smooth(progressAt(elapsed, t.panelStart, t.panelEnd - t.panelStart))
  return {
    paperProgress, paperX: t.paperTravel * (1 - paperProgress),
    redProgress, redX: -t.redTravel * (1 - redProgress) || 0,
    panelProgress, panelScale: .78 + .22 * panelProgress,
    panelOpacity: panelProgress,
    panelRadius: 50 * (1 - panelProgress),
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
  const redProgress = smooth(progressAt(elapsed, timeline.redStart, timeline.redDuration))
  const paperProgress = smooth(progressAt(elapsed, timeline.paperStart, timeline.paperDuration))
  return {
    panelProgress,
    panelScale: elapsed <= timeline.panelPrepare
      ? 1 + 0.025 * prep : 1.025 * (1 - panelProgress),
    panelRadius: 50 * smooth(panelProgress / 0.7),
    panelOpacity: 1 - smooth(panelProgress),
    redProgress, redX: -timeline.redTravel * redProgress,
    paperProgress, paperX: -timeline.paperTravel * paperProgress,
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
  const progress = smooth(progressAt(elapsed, spec.start, spec.duration))
  return {
    opacity: progress,
    x: spec.x * (1 - progress) || 0, y: spec.y * (1 - progress) || 0,
    done: elapsed >= spec.start + spec.duration,
  }
}

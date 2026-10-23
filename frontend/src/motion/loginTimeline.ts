import { DURATION, FACTORY_ENTRANCE, LOGIN_SEQUENCE } from './tokens'

export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value))
export function smooth(value: number): number {
  const x = clamp(value)
  return x * x * (3 - 2 * x)
}
const progressAt = (elapsed: number, start: number, duration: number) =>
  clamp((elapsed - start) / duration)

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
  const viewport = Math.max(1, geometry.viewportWidth)
  const redTravel = Math.max(1, geometry.redTravel)
  // Shorter paths get shorter durations. This guarantees red's average px/ms
  // is at least paper's, even when responsive layouts change the brand width.
  const redDuration = Math.min(
    LOGIN_SEQUENCE.redEnd - LOGIN_SEQUENCE.redEarliestStart,
    paperDuration * redTravel / viewport * 0.95,
  )
  const redStart = LOGIN_SEQUENCE.redEnd - redDuration
  return {
    total, panelStart, panelPrepare, panelEnd,
    redStart, redDuration, redEnd: LOGIN_SEQUENCE.redEnd,
    paperStart, paperDuration, paperEnd: total,
    redTravel, paperTravel: viewport,
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

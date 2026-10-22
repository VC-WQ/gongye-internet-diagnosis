/** The login panel reads A's clock; it never owns a frame loop or navigation. */
export interface IntroFrame {
  readonly epoch: number
  readonly progress: number
  readonly active: boolean
}
export type IntroListener = (frame: IntroFrame) => void
export type SubscribeIntro = (listener: IntroListener) => () => void

const clamp01 = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

export class IntroProgressChannel {
  private frame: IntroFrame = { epoch: 0, progress: 1, active: false }
  private readonly listeners = new Set<IntroListener>()

  constructor(private readonly onError: (error: unknown) => void = console.error) {}

  private deliver(listener: IntroListener) {
    try {
      listener(this.frame)
    } catch (error) {
      // A decorative subscriber must never stop A or keep authentication locked.
      this.listeners.delete(listener)
      try { this.onError(error) } catch { /* diagnostics cannot interrupt A either */ }
    }
  }

  private emit() {
    for (const listener of this.listeners) this.deliver(listener)
  }

  subscribe: SubscribeIntro = (listener) => {
    this.listeners.add(listener)
    this.deliver(listener)
    return () => { this.listeners.delete(listener) }
  }

  begin(epoch: number) {
    if (epoch < this.frame.epoch) return
    this.frame = { epoch, progress: 0, active: true }
    this.emit()
  }

  publish(epoch: number, progress: number) {
    if (epoch !== this.frame.epoch || !this.frame.active) return
    this.frame = { epoch, progress: Math.max(this.frame.progress, clamp01(progress)), active: true }
    this.emit()
  }

  finish(epoch: number) {
    if (epoch !== this.frame.epoch) return
    this.frame = { epoch, progress: 1, active: false }
    this.emit()
  }

  cancel(epoch: number) {
    if (epoch < this.frame.epoch) return
    this.frame = { epoch, progress: 1, active: false }
    this.emit()
  }

  clear() { this.listeners.clear() }
}

export const LOGIN_ENTRIES = ['heading', 'support', 'switch', 'username', 'password', 'action', 'footer'] as const
export type LoginEntry = typeof LOGIN_ENTRIES[number]

// The red cover still obscures the left of the panel around A=.5. On mobile,
// allow it another .08 before revealing the heading. All entries end within A.
const DESKTOP_RANGES: Record<LoginEntry, readonly [number, number]> = {
  heading: [.50, .72], support: [.56, .76], switch: [.60, .80],
  username: [.65, .85], password: [.70, .90], action: [.77, .96], footer: [.83, 1],
}
const MOBILE_RANGES: Record<LoginEntry, readonly [number, number]> = {
  heading: [.58, .77], support: [.62, .81], switch: [.66, .84],
  username: [.70, .88], password: [.74, .92], action: [.80, .97], footer: [.86, 1],
}

export function localIntroProgress(progress: number, start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
    throw new RangeError('Invalid login entry range')
  }
  const p = clamp01((clamp01(progress) - start) / (end - start))
  return p * p * (3 - 2 * p)
}

export function sampleLoginEntry(progress: number, entry: LoginEntry, mobile: boolean) {
  const [start, end] = (mobile ? MOBILE_RANGES : DESKTOP_RANGES)[entry]
  const mix = localIntroProgress(progress, start, end)
  return { opacity: mix, y: (entry === 'heading' ? 14 : 10) * (1 - mix),
    clip: entry === 'heading' ? 100 * (1 - mix) : 0, done: progress >= end }
}

export function clearLoginEntryStyles(node: HTMLElement) {
  for (const name of ['opacity', 'transform', 'clip-path', 'will-change']) node.style.removeProperty(name)
}

/** Query on each shared A frame so destroyOnHidden/new form nodes cannot stay hidden. */
export function renderLoginEntries(root: HTMLElement, frame: IntroFrame, mobile: boolean) {
  for (const node of root.querySelectorAll<HTMLElement>('[data-login-entry]')) {
    const entry = node.dataset.loginEntry as LoginEntry
    if (!frame.active || frame.progress >= 1 || !LOGIN_ENTRIES.includes(entry)) {
      clearLoginEntryStyles(node)
      continue
    }
    const sample = sampleLoginEntry(frame.progress, entry, mobile)
    if (sample.done) { clearLoginEntryStyles(node); continue }
    node.style.opacity = String(sample.opacity)
    node.style.transform = `translate3d(0, ${sample.y.toFixed(3)}px, 0)`
    if (entry === 'heading') node.style.clipPath = `inset(0 0 ${sample.clip.toFixed(3)}% 0)`
    node.style.willChange = entry === 'heading' ? 'transform, opacity, clip-path' : 'transform, opacity'
  }
}

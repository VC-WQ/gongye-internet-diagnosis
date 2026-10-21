export interface NativeTransition {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition: () => void
}

export interface TransitionWork {
  commit: () => void | Promise<void>
  ready?: () => Promise<void>
  presented?: (native: boolean) => void
  cleanup?: () => void
}

type StartTransition = (update: () => Promise<void>) => NativeTransition

/** Latest intent owns both the DOM commit and its visual work. No DOM dependency. */
export class MotionCoordinator {
  private generation = 0
  private active?: { generation: number; native?: NativeTransition; visualSkipped: boolean; release: () => void; cleanup: () => void }

  cancel() {
    this.generation += 1
    const previous = this.active
    this.active = undefined
    previous?.native?.skipTransition()
    previous?.release()
    previous?.cleanup()
  }

  /** Reduced motion / a slow route skips snapshots without losing its navigation. */
  skipVisual() {
    if (!this.active) return
    this.active.visualSkipped = true
    this.active.native?.skipTransition()
  }

  run(work: TransitionWork, start?: StartTransition): Promise<void> {
    this.cancel()
    const generation = this.generation
    let release!: () => void
    const cancelled = new Promise<void>(resolve => { release = resolve })
    let cleaned = false
    const ticket = {
      generation, native: undefined as NativeTransition | undefined, visualSkipped: false, release,
      cleanup: () => { if (!cleaned) { cleaned = true; work.cleanup?.() } },
    }
    this.active = ticket
    const current = () => this.active === ticket && this.generation === generation
    let updateStarted = false
    let updateDone: Promise<void> | undefined
    const update = () => {
      if (updateStarted) return updateDone ?? Promise.resolve()
      updateStarted = true
      updateDone = (async () => {
        if (!current()) return
        await work.commit()
        if (!current()) return
        await Promise.race([work.ready?.() ?? Promise.resolve(), cancelled])
        if (current()) work.presented?.(Boolean(ticket.native) && !ticket.visualSkipped)
      })()
      return updateDone
    }
    let done: Promise<void>
    if (start) {
      try {
        ticket.native = start(update)
        // ready rejects for skipped/unsupported captures; navigation still commits.
        void ticket.native.ready.catch(() => { ticket.visualSkipped = true })
        // skipTransition may end the visual handle while a lazy route is still
        // preparing. Keep its readiness listener until the actual update ends.
        // If a browser rejects before invoking update, the guarded call still
        // performs navigation exactly once.
        done = Promise.race([ticket.native.finished.catch(() => {}).then(update), cancelled])
      } catch {
        done = update()
      }
    } else done = update()
    return done.catch(() => {}).finally(() => {
      ticket.cleanup()
      if (this.active === ticket) this.active = undefined
    })
  }
}

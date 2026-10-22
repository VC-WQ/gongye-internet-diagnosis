export type GrowthPhase = 'idle' | 'growing' | 'expanded' | 'collapsing'

const MAX_SPEED = 1.2 // progress per second
const ACCELERATION = 8 // progress per second squared
const STEP_SECONDS = 1 / 240
const MAX_TICK_MS = 2000 // bounded work even after a suspended/background frame

/** One reversible progress/velocity pair; scheduling and rendering belong to runtime. */
export class GrowthMotion {
  activeId: string | null = null
  requestedId: string | null = null
  p = 0
  v = 0
  phase: GrowthPhase = 'idle'

  reset() {
    this.activeId = null
    this.requestedId = null
    this.p = 0
    this.v = 0
    this.phase = 'idle'
  }

  private settle() {
    this.activeId = this.requestedId
    this.p = this.activeId === null ? 0 : 1
    this.v = 0
    this.phase = this.activeId === null ? 'idle' : 'expanded'
  }

  private reconcile() {
    // Only the zero seam can exchange visual identities. The latest request is
    // the entire queue; A -> B -> A above zero reuses A and its current velocity.
    if (this.activeId === null || (this.p === 0 && this.v === 0 && this.activeId !== this.requestedId)) {
      this.activeId = this.requestedId
      this.p = 0
      this.v = 0
    }
    if (this.activeId === null) this.phase = 'idle'
    else if (this.activeId !== this.requestedId) this.phase = 'collapsing'
    else this.phase = this.p === 1 && this.v === 0 ? 'expanded' : 'growing'
  }

  request(id: string | null, reduced = false) {
    this.requestedId = id
    if (reduced) { this.settle(); return }
    this.reconcile()
  }

  /** Returns whether runtime still needs frames. Invalid/nonpositive dt leaves
   * the current interruption point intact; a large finite dt uses bounded small
   * physical steps rather than resetting progress or integrating one huge jump.
   */
  tick(dtMs: number, reduced = false): boolean {
    if (reduced) { this.settle(); return false }
    this.reconcile()
    if (!Number.isFinite(dtMs) || dtMs <= 0) return this.phase === 'growing' || this.phase === 'collapsing'
    let remaining = Math.min(dtMs, MAX_TICK_MS) / 1000
    while (remaining > 1e-12 && (this.phase === 'growing' || this.phase === 'collapsing')) {
      const step = Math.min(STEP_SECONDS, remaining)
      remaining -= step
      const target = this.phase === 'growing' ? 1 : 0
      const distance = target - this.p
      const direction = Math.sign(distance)
      // sqrt(2*a*d) is the maximum speed that can stop at the target. Moving
      // away after a retarget decelerates first, retaining reversal momentum.
      const desired = direction * Math.min(MAX_SPEED, Math.sqrt(2 * ACCELERATION * Math.abs(distance)))
      const nextV = this.v + Math.max(-ACCELERATION * step, Math.min(ACCELERATION * step, desired - this.v))
      const nextP = this.p + (this.v + nextV) * .5 * step
      const arrived = direction === 0 || (target === 1 ? nextP >= 1 : nextP <= 0)
      if (arrived) {
        this.p = target
        this.v = 0
      } else {
        this.p = Math.max(0, Math.min(1, nextP))
        this.v = this.p === nextP ? nextV : 0
      }
      this.reconcile()
    }
    return this.phase === 'growing' || this.phase === 'collapsing'
  }
}

import { GrowthMotion } from "./growthMotion";

export interface FocusCamera {
  x: number;
  y: number;
  zoom: number;
}
export interface FocusFrame {
  epoch: number;
  deviceId: string | null;
  progress: number;
  settled: boolean;
  startedAt: number;
  settledAt?: number;
}
const clamp = (p: number) => Math.max(0, Math.min(1, p));
const smooth = (p: number) => {
  const x = clamp(p);
  return x * x * (3 - 2 * x);
};
const remaining = (
  camera: FocusCamera,
  target: FocusCamera,
  velocity: FocusCamera,
) =>
  Math.hypot(
    target.x - camera.x,
    target.y - camera.y,
    (target.zoom - camera.zoom) * 360,
    velocity.x * 0.075,
    velocity.y * 0.075,
    velocity.zoom * 27,
  );

/** Measures the original spring, rather than introducing another camera clock. */
export class CameraFocusProgress {
  private initial = 1;
  private value: FocusFrame = {
    epoch: 0,
    deviceId: null,
    progress: 1,
    settled: true,
    startedAt: 0,
  };
  begin(
    deviceId: string | null,
    camera: FocusCamera,
    target: FocusCamera,
    velocity: FocusCamera,
    now: number,
  ) {
    this.initial = Math.max(remaining(camera, target, velocity), 1e-8);
    this.value = {
      epoch: this.value.epoch + 1,
      deviceId,
      progress: 0,
      settled: false,
      startedAt: now,
    };
  }
  sample(
    camera: FocusCamera,
    target: FocusCamera,
    velocity: FocusCamera,
    settled: boolean,
    now: number,
  ): FocusFrame {
    if (!this.value.settled) {
      this.value.progress = settled
        ? 1
        : Math.max(
            this.value.progress,
            Math.min(
              0.999,
              1 - remaining(camera, target, velocity) / this.initial,
            ),
          );
      if (settled) {
        this.value.settled = true;
        this.value.settledAt = now;
      }
    }
    return this.read();
  }
  read(): FocusFrame {
    return { ...this.value };
  }
}

export interface VisualEntry {
  id: string;
  motion: GrowthMotion;
  epoch: number;
  startP: number;
  startV: number;
  startAt: number;
  startProgress: number;
}

/** One renderer may hold a bounded set of short-lived outgoing models. The
 * selected model begins immediately; outgoing models share its actual focus
 * seam. No chart/provider/business identity is retained by this visual state.
 */
export class VisualGrowthCoordinator {
  readonly entries = new Map<string, VisualEntry>();
  requestedId: string | null = null;
  private pressureId: string | null = null;
  private uncoordinatedClear = false;
  constructor(readonly capacity = 4) {}
  reset() {
    this.entries.clear();
    this.requestedId = null;
    this.pressureId = null;
    this.uncoordinatedClear = false;
  }
  pause(duration: number) {
    for (const entry of this.entries.values()) entry.startAt += duration;
  }
  drop(id: string) {
    this.entries.delete(id);
    if (this.pressureId === id) this.pressureId = null;
  }
  private acquire(now: number) {
    const id = this.requestedId;
    if (!id || this.entries.has(id) || this.entries.size >= this.capacity)
      return;
    const motion = new GrowthMotion();
    motion.request(id);
    this.entries.set(id, {
      id,
      motion,
      epoch: -1,
      startP: 0,
      startV: 0,
      startAt: now,
      startProgress: 0,
    });
  }
  update(
    id: string | null,
    focus: FocusFrame,
    now: number,
    dtMs: number,
    reduced = false,
  ) {
    if (this.requestedId !== null && id === null && focus.deviceId === null && focus.settled)
      this.uncoordinatedClear = true;
    if (id !== null || !focus.settled) this.uncoordinatedClear = false;
    this.requestedId = id;
    // Capacity pressure queues only the latest identity. Existing geometry is
    // never cut off above zero; the ordinary A/B/C path uses at most 3 entries.
    this.acquire(now);
    const coordinated = focus.deviceId === id;
    // Under synthetic bursts beyond the four-slot budget, retire the smallest
    // outgoing silhouette with the reversible integrator. It frees a slot
    // during focus, instead of waiting until the last frame and popping in.
    if (this.pressureId === id || (this.pressureId && !this.entries.has(this.pressureId)))
      this.pressureId = null;
    if (id && !this.entries.has(id) && !this.pressureId)
      this.pressureId = [...this.entries.values()].sort((a,b) => a.motion.p-b.motion.p)[0]?.id ?? null;
    const pressure = this.pressureId ? this.entries.get(this.pressureId) : undefined;
    for (const entry of this.entries.values()) {
      const target = entry.id === id ? 1 : 0,
        motion = entry.motion;
      if (reduced) {
        motion.request(target ? entry.id : null, true);
      } else if (coordinated && !this.uncoordinatedClear && (entry !== pressure || focus.settled)) {
        if (entry.epoch !== focus.epoch) {
          entry.epoch = focus.epoch;
          entry.startP = motion.p;
          entry.startV = motion.v;
          entry.startAt = now;
          entry.startProgress = focus.progress;
        }
        const progress = focus.settled
          ? 1
          : clamp(
              (focus.progress - entry.startProgress) /
                Math.max(1e-8, 1 - entry.startProgress),
            );
        const mix = smooth(progress),
          elapsed = Math.max(0, (now - entry.startAt) / 1000);
        // The short decaying tangent retains reversal momentum. Both value and
        // tangent vanish at the common spring seam, independent of refresh rate.
        const tangent =
          entry.startV * elapsed * Math.exp(-elapsed / 0.08) * (1 - mix);
        const previous = motion.p;
        motion.p = focus.settled
          ? target
          : clamp(entry.startP + (target - entry.startP) * mix + tangent);
        if (!focus.settled && target === 1)
          motion.p = Math.min(0.99999, motion.p);
        motion.v = focus.settled
          ? 0
          : dtMs > 0
            ? (motion.p - previous) / (dtMs / 1000)
            : motion.v;
        motion.activeId = entry.id;
        motion.requestedId = target ? entry.id : null;
        motion.phase = target
          ? focus.settled
            ? "expanded"
            : "growing"
          : "collapsing";
      } else {
        // A request can commit one layout effect before the parent focus frame.
        // Keep continuity during that bounded handover and on a 2D-only camera.
        motion.request(target ? entry.id : null);
        motion.tick(dtMs);
        // Every integrator-to-camera handover must capture its actual pose.
        // Capacity pressure can span several epochs before a slot reaches zero.
        entry.epoch = -1;
      }
    }
    for (const [key, entry] of this.entries)
      if (key !== id && entry.motion.p === 0 && entry.motion.v === 0)
        this.drop(key);
    this.acquire(now);
  }
  get moving() {
    return [...this.entries.values()].some(
      (e) => e.motion.phase === "growing" || e.motion.phase === "collapsing",
    );
  }
}

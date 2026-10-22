import type { Affine } from './projection'

export type ScenePointerInput = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'button' | 'pointerType' | 'target'>
export interface DeviceAnchor {
  deviceId: string
  matrix: Affine
  width: number
  height: number
  sequence: number
  sceneMoving: boolean
  pointerBusy: boolean
}
export interface SceneConnection {
  read: (id: string) => DeviceAnchor | null
  blend: (id: string, progress: number) => void
  wheel: (event: WheelEvent) => void
  gesture: (event: Event) => void
  pointerDown: (event: ScenePointerInput) => void
  clear: () => void
}

/** A view bridge, not a second source of device identity or camera state. */
export class DeviceSceneBridge {
  private connection: SceneConnection | null = null
  private readonly listeners = new Set<(now: number) => void>()
  private rotationTransfer: ((event: ScenePointerInput) => ScenePointerInput | null) | null = null
  connect(value: SceneConnection) {
    this.connection = value
    this.afterPaint()
    return () => { if (this.connection === value) this.connection = null }
  }
  read(id: string) { return this.connection?.read(id) ?? null }
  blend(id: string, progress: number) { this.connection?.blend(id, progress) }
  wheel(event: WheelEvent) { this.connection?.wheel(event) }
  gesture(event: Event) { this.connection?.gesture(event) }
  pointerDown(event: ScenePointerInput) { this.connection?.pointerDown(event) }
  registerRotationTransfer(handler: (event: ScenePointerInput) => ScenePointerInput | null) {
    this.rotationTransfer = handler
    return () => { if (this.rotationTransfer === handler) this.rotationTransfer = null }
  }
  transferRotationToScene(event: ScenePointerInput) { return this.rotationTransfer?.(event) ?? null }
  clear() { this.connection?.clear() }
  subscribe(listener: (now: number) => void) {
    this.listeners.add(listener)
    listener(performance.now())
    return () => { this.listeners.delete(listener) }
  }
  afterPaint(now = performance.now()) {
    for (const listener of this.listeners) {
      try { listener(now) } catch (error) { console.error('Device visual bridge failed', error) }
    }
  }
}

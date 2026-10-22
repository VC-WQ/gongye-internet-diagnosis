import type { Group } from 'three'

export type ModelKind = 'compressor' | 'pump' | 'motor' | 'generic'
export type ModelStages = Readonly<Record<'base' | 'body' | 'mechanics' | 'details', Group>>

export interface DeviceModelStats {
  readonly kind: ModelKind
  readonly meshes: number
  readonly geometries: number
  readonly materials: number
  readonly vertices: number
  readonly triangles: number
}

/** Visual geometry only: it does not represent a device's CAD or business state. */
export interface DeviceModel {
  readonly root: Group
  /** Rotate this group around Y; the shared platform remains fixed. */
  readonly turntable: Group
  readonly stages: ModelStages
  readonly stats: DeviceModelStats
  applyProgress(progress: number): void
  setAccent(color: string): void
  /** Owns only resources created by this instance; safe to call more than once. */
  dispose(): void
}

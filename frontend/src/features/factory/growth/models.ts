import * as THREE from 'three'
import type { DeviceModel, DeviceModelStats, ModelKind } from './modelTypes'

export type { DeviceModel, DeviceModelStats, ModelKind, ModelStages } from './modelTypes'

const DEFAULT_ACCENT = '#7D96AA'
const UP = new THREE.Vector3(0, 1, 0)
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const segment = (p: number, start: number, end: number) => {
  const value = clamp01((p - start) / (end - start))
  return value * value * (3 - 2 * value)
}
const validAccent = (color: string) => /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCENT
type Position = readonly [number, number, number]
type Axis = 'x' | 'y' | 'z'

/** One instance owns all its geometry/materials. No renderer, texture or clock is created. */
export function buildDeviceModel(kind: ModelKind, accent = DEFAULT_ACCENT, light = false): DeviceModel {
  const actualKind: ModelKind = ['compressor', 'pump', 'motor'].includes(kind) ? kind : 'generic'
  const root = new THREE.Group()
  root.name = `DeviceVisual:${actualKind}`
  const base = new THREE.Group(); base.name = 'Base'
  const turntable = new THREE.Group(); turntable.name = 'DeviceTurntable'
  const body = new THREE.Group(); body.name = 'MainBody'; body.position.y = 0.05
  const mechanics = new THREE.Group(); mechanics.name = 'MechanicalParts'; mechanics.position.y = 0.40
  const details = new THREE.Group(); details.name = 'Details'; details.position.y = 0.12
  root.add(base, turntable)
  turntable.add(body, mechanics, details)
  const stages = Object.freeze({ base, body, mechanics, details })
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => { geometries.add(geometry); return geometry }
  const material = (color: string, metalness = 0.25, roughness = 0.67) => {
    const value = new THREE.MeshStandardMaterial({ color, metalness, roughness })
    materials.add(value)
    return value
  }
  const shell = material(light ? '#8C969D' : '#667580', 0.32)
  const metal = material(light ? '#C4CDD0' : '#A3ADB2', 0.48, 0.52)
  const dark = material(light ? '#48555F' : '#34424D', 0.18, 0.76)
  const recess = actualKind === 'compressor' || actualKind === 'generic'
    ? material(light ? '#293740' : '#202C35', 0.10, 0.82) : dark
  const trim = material(validAccent(accent), 0.22, 0.62)
  const accentMaterials = [trim]

  const mesh = (stage: THREE.Group, name: string, geometry: THREE.BufferGeometry, finish: THREE.Material, position: Position) => {
    const value = new THREE.Mesh(ownGeometry(geometry), finish)
    value.name = name
    // Builders use completed model coordinates; each stage retains its own ground/connection pivot.
    value.position.set(position[0], position[1] - stage.position.y, position[2])
    stage.add(value)
    return value
  }
  const box = (stage: THREE.Group, name: string, size: Position, position: Position, finish = shell) =>
    mesh(stage, name, new THREE.BoxGeometry(...size), finish, position)
  const cylinder = (stage: THREE.Group, name: string, radius: number, length: number, position: Position, axis: Axis = 'y', finish = shell, segments = 20) => {
    const value = mesh(stage, name, new THREE.CylinderGeometry(radius, radius, length, segments), finish, position)
    if (axis === 'x') value.rotation.z = -Math.PI / 2
    if (axis === 'z') value.rotation.x = Math.PI / 2
    return value
  }
  const ring = (stage: THREE.Group, name: string, radius: number, tube: number, position: Position, axis: Axis = 'x', finish = metal) => {
    const value = mesh(stage, name, new THREE.TorusGeometry(radius, tube, 8, 28), finish, position)
    if (axis === 'x') value.rotation.y = Math.PI / 2
    if (axis === 'y') value.rotation.x = Math.PI / 2
    return value
  }
  const pipe = (stage: THREE.Group, name: string, from: Position, to: Position, radius = 0.055, finish = metal) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to)
    const direction = b.clone().sub(a)
    const center = a.clone().add(b).multiplyScalar(0.5)
    const value = cylinder(stage, name, radius, direction.length(), [center.x, center.y, center.z], 'y', finish, 12)
    value.quaternion.setFromUnitVectors(UP, direction.normalize())
    return value
  }
  const feet = (length = 1.35, depth = 0.64) => {
    for (const x of [-length / 2, length / 2]) for (const z of [-depth / 2, depth / 2])
      box(body, 'MountingFoot', [0.22, 0.12, 0.19], [x, 0.06, z], dark)
  }

  // Invert the SVG reference plane, retaining its one-unit hand-drawn asymmetry.
  // Extrusion starts at the reference top Y=0 and extends downward; growth keeps that top fixed.
  const shape = new THREE.Shape()
  const svgCorners = [[0, -35], [103, 19], [0, 74], [-103, 19]] as const
  svgCorners.forEach(([x, y], index) => {
    const X = (x / 51.5 + (y - 19.5) / 27.25) / 2
    const Z = (-x / 51.5 + (y - 19.5) / 27.25) / 2
    if (index === 0) shape.moveTo(X, Z)
    else shape.lineTo(X, Z)
  })
  shape.closePath()
  const platform = new THREE.ExtrudeGeometry(shape, { depth: 0.08, steps: 1, bevelEnabled: false })
  platform.rotateX(Math.PI / 2)
  mesh(base, 'SharedReferencePlatform', platform, dark, [0, 0, 0])
  // Low profile corners/rails are decorative only; the reference polygon remains the anchor.
  box(base, 'PlatformAccent', [0.55, 0.018, 0.035], [0.37, -0.017, 0.92], trim)

  if (actualKind === 'pump') {
    feet(1.28, 0.58)
    cylinder(body, 'PumpMotor', 0.28, 0.84, [-0.30, 0.40, 0], 'x')
    cylinder(body, 'PumpRearCover', 0.30, 0.07, [-0.75, 0.40, 0], 'x', dark)
    cylinder(body, 'PumpCasing', 0.34, 0.30, [0.43, 0.47, 0], 'x', shell)
    ring(body, 'PumpVolute', 0.275, 0.09, [0.43, 0.47, 0], 'x', trim)
    cylinder(mechanics, 'PumpCoupling', 0.115, 0.35, [0.12, 0.40, 0], 'x', metal)
    cylinder(mechanics, 'PumpIntake', 0.115, 0.25, [0.68, 0.47, 0], 'x', metal)
    cylinder(mechanics, 'PumpIntakeFlange', 0.18, 0.055, [0.80, 0.47, 0], 'x', dark)
    pipe(mechanics, 'PumpOutlet', [0.43, 0.72, 0], [0.43, 1.29, 0], 0.10, metal)
    cylinder(mechanics, 'PumpOutletFlange', 0.19, 0.07, [0.43, 1.31, 0], 'y', dark)
    for (let i = 0; i < 6; i++) ring(details, 'PumpCoolingRib', 0.29, 0.022, [-0.64 + i * 0.12, 0.40, 0], 'x', dark)
    box(details, 'PumpNameplate', [0.23, 0.12, 0.018], [-0.29, 0.48, 0.285], trim)
    for (const z of [-0.23, 0.23]) cylinder(details, 'PumpCasingBolt', 0.032, 0.045, [0.60, 0.47, z], 'x', metal, 8)
  } else if (actualKind === 'motor') {
    feet(1.10, 0.60)
    cylinder(body, 'MotorHousing', 0.36, 1.10, [-0.05, 0.52, 0], 'x')
    cylinder(body, 'MotorRearCover', 0.38, 0.07, [-0.64, 0.52, 0], 'x', dark)
    cylinder(body, 'MotorDriveCover', 0.38, 0.08, [0.54, 0.52, 0], 'x', metal)
    box(mechanics, 'MotorTerminalBox', [0.46, 0.38, 0.40], [-0.18, 1.12, 0], dark)
    box(mechanics, 'MotorTerminalLid', [0.51, 0.045, 0.45], [-0.18, 1.335, 0], trim)
    cylinder(mechanics, 'MotorDriveShaft', 0.09, 0.28, [0.68, 0.52, 0], 'x', metal)
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6
      const fin = box(details, 'MotorCoolingFin', [0.97, 0.06, 0.12], [-0.05, 0.52 + Math.cos(angle) * 0.39, Math.sin(angle) * 0.39], dark)
      fin.rotation.x = angle
    }
    ring(details, 'MotorAccentBand', 0.365, 0.02, [0.34, 0.52, 0], 'x', trim)
    box(details, 'MotorNameplate', [0.29, 0.13, 0.02], [-0.19, 0.57, 0.43], metal)
  } else if (actualKind === 'compressor') {
    feet(1.30, 0.66)
    box(body, 'CompressorCabinet', [1.20, 1.20, 0.80], [-0.12, 0.71, 0])
    box(body, 'CompressorHood', [1.26, 0.10, 0.86], [-0.12, 1.36, 0], dark)
    cylinder(body, 'CompressorPressureVessel', 0.16, 0.92, [0.62, 0.69, 0.06], 'y', metal)
    cylinder(mechanics, 'CompressorVesselCap', 0.18, 0.06, [0.62, 1.18, 0.06], 'y', dark)
    pipe(mechanics, 'CompressorRiser', [-0.35, 1.36, 0], [-0.35, 1.54, 0])
    pipe(mechanics, 'CompressorTopPipe', [-0.35, 1.54, 0], [0.62, 1.54, 0])
    pipe(mechanics, 'CompressorVesselPipe', [0.62, 1.54, 0], [0.62, 1.20, 0.06])
    cylinder(mechanics, 'CompressorValve', 0.10, 0.045, [0.78, 1.20, 0.06], 'x', trim)
    for (let i = 0; i < 8; i++) box(details, 'CompressorVent', [0.075, 0.55, 0.035], [-0.58 + i * 0.12, 0.64, 0.425], recess)
    ring(details, 'CompressorGaugeRim', 0.105, 0.022, [0.19, 1.15, 0.43], 'z', metal)
    cylinder(details, 'CompressorGauge', 0.092, 0.015, [0.19, 1.15, 0.44], 'z', dark)
    box(details, 'CompressorIdentification', [0.48, 0.075, 0.02], [-0.22, 1.20, 0.415], trim)
  } else {
    feet(1.05, 0.60)
    box(body, 'GenericCabinet', [1.20, 1.02, 0.85], [0, 0.58, 0])
    box(body, 'GenericUpperHousing', [0.48, 0.34, 0.60], [-0.20, 1.26, 0], dark)
    pipe(mechanics, 'GenericSideRiser', [0.69, 0.25, 0], [0.69, 1.00, 0], 0.065)
    pipe(mechanics, 'GenericSideConnection', [0.51, 1.00, 0], [0.69, 1.00, 0], 0.065)
    pipe(mechanics, 'GenericHandleLeft', [-0.37, 1.43, 0], [-0.37, 1.54, 0], 0.035, dark)
    pipe(mechanics, 'GenericHandleRight', [-0.03, 1.43, 0], [-0.03, 1.54, 0], 0.035, dark)
    pipe(mechanics, 'GenericHandleTop', [-0.37, 1.54, 0], [-0.03, 1.54, 0], 0.035, dark)
    for (let i = 0; i < 5; i++) box(details, 'GenericVent', [0.58, 0.035, 0.025], [0.03, 0.41 + i * 0.12, 0.435], recess)
    box(details, 'GenericIdentification', [0.46, 0.13, 0.02], [0.06, 0.96, 0.438], trim)
    for (const x of [-0.47, 0.47]) cylinder(details, 'GenericFastener', 0.035, 0.025, [x, 0.89, 0.44], 'z', metal, 8)
  }

  let meshes = 0, vertices = 0, triangles = 0
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    meshes++
    vertices += object.geometry.getAttribute('position').count
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
  })
  const stats: DeviceModelStats = Object.freeze({ kind: actualKind, meshes, geometries: geometries.size, materials: materials.size, vertices, triangles })
  let disposed = false
  const applyProgress = (progress: number) => {
    if (disposed) return
    const p = clamp01(progress)
    root.visible = p > 0
    const b = segment(p, 0, 0.28), m = segment(p, 0.18, 0.75)
    const mechanical = segment(p, 0.40, 0.92), detail = segment(p, 0.64, 1)
    base.visible = b > 0
    base.scale.set(0.35 + b * 0.65, Math.max(0.001, b), 0.35 + b * 0.65)
    body.visible = m > 0
    body.scale.set(0.88 + m * 0.12, Math.max(0.001, m), 0.88 + m * 0.12)
    mechanics.visible = mechanical > 0
    mechanics.scale.set(0.85 + mechanical * 0.15, Math.max(0.001, mechanical), 0.85 + mechanical * 0.15)
    details.visible = detail > 0
    const detailScale = 0.35 + detail * 0.65
    details.scale.set(detailScale, Math.max(0.001, detail), detailScale)
  }
  applyProgress(0)
  return {
    root, turntable, stages, stats, applyProgress,
    setAccent(color) {
      if (!disposed) for (const finish of accentMaterials) finish.color.set(validAccent(color))
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.visible = false
      root.removeFromParent()
      for (const geometry of geometries) geometry.dispose()
      for (const finish of materials) finish.dispose()
      geometries.clear(); materials.clear()
      for (const stage of Object.values(stages)) stage.clear()
      turntable.clear(); root.clear()
    },
  }
}

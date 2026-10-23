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
  const turned = (stage: THREE.Group, name: string, profile: readonly (readonly [number, number])[], position: Position, axis: Axis = 'x', finish = shell) => {
    const value = mesh(stage, name, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 28), finish, position)
    if (axis === 'x') value.rotation.z = -Math.PI / 2
    if (axis === 'z') value.rotation.x = Math.PI / 2
    return value
  }
  const instances = (stage: THREE.Group, name: string, geometry: THREE.BufferGeometry, finish: THREE.Material,
    placements: { position: Position; rotation?: Position }[]) => {
    const value = new THREE.InstancedMesh(ownGeometry(geometry), finish, placements.length)
    value.name = name
    const transform = new THREE.Object3D()
    placements.forEach(({ position, rotation = [0,0,0] }, index) => {
      transform.position.set(position[0],position[1]-stage.position.y,position[2])
      transform.rotation.set(...rotation); transform.updateMatrix()
      value.setMatrixAt(index,transform.matrix)
    })
    value.computeBoundingBox(); value.computeBoundingSphere()
    stage.add(value)
    return value
  }
  const softBox = (stage: THREE.Group, name: string, size: Position, position: Position, finish = shell) => {
    const bevel=.012,r=.035,x=-size[0]/2+bevel,y=-size[1]/2+bevel,w=size[0]-2*bevel,h=size[1]-2*bevel
    const outline=new THREE.Shape()
    outline.moveTo(x+r,y);outline.lineTo(x+w-r,y);outline.quadraticCurveTo(x+w,y,x+w,y+r)
    outline.lineTo(x+w,y+h-r);outline.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
    outline.lineTo(x+r,y+h);outline.quadraticCurveTo(x,y+h,x,y+h-r)
    outline.lineTo(x,y+r);outline.quadraticCurveTo(x,y,x+r,y)
    const geometry=new THREE.ExtrudeGeometry(outline,{depth:size[2]-2*bevel,steps:1,bevelEnabled:true,bevelSegments:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:3})
    geometry.translate(0,0,-size[2]/2+bevel)
    return mesh(stage,name,geometry,finish,position)
  }
  const contactPatch = (name: string, x: number, z: number) => {
    const finish = new THREE.MeshBasicMaterial({ color:'#152029',transparent:true,opacity:light ? .08 : .13,depthWrite:false })
    materials.add(finish)
    const geometry = new THREE.CircleGeometry(1,28)
    for(const size of [.72,.94]) {
      const shadow=mesh(base,name,geometry,finish,[0,.002,0])
      shadow.rotation.x=-Math.PI/2;shadow.scale.set(x*size,z*size,1)
    }
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
    // A horizontal end-suction pump: motor -> guarded coupling -> stepped
    // volute housing, with a bored inlet and vertical flanged delivery pipe.
    // The platform and completed envelope are deliberately unchanged.
    feet(1.28, 0.58)
    box(body, 'PumpMotorCradle', [0.58, 0.11, 0.40], [-0.38, 0.145, 0], dark)
    box(body, 'PumpCasingCradle', [0.30, 0.12, 0.45], [0.43, 0.15, 0], dark)
    turned(body, 'PumpMotor', [[0,-.40],[.24,-.40],[.28,-.35],[.28,.34],[.24,.40],[0,.40]], [-.32,.43,0])
    turned(body, 'PumpRearCover', [[0,-.05],[.25,-.05],[.285,-.025],[.285,.035],[.27,.05],[0,.05]], [-.76,.43,0], 'x', dark)
    turned(body, 'PumpCasing', [[0,-.17],[.23,-.17],[.32,-.12],[.34,-.06],[.34,.08],[.29,.15],[0,.15]], [.43,.49,0])
    turned(body, 'PumpCasingSeam', [[.33,-.008],[.346,-.008],[.346,.008],[.33,.008],[.33,-.008]], [.46,.49,0], 'x', dark)
    cylinder(mechanics, 'PumpCoupling', .10, .32, [.12,.43,0], 'x', metal)
    const guard = mesh(mechanics, 'PumpCouplingGuard', new THREE.CylinderGeometry(.17,.17,.26,20,1,true,Math.PI,Math.PI), trim, [.13,.43,0])
    guard.rotation.z = -Math.PI / 2
    cylinder(mechanics, 'PumpIntakeNeck', .118, .20, [.66,.49,0], 'x', metal)
    const inletProfile = [[.09,-.03],[.18,-.03],[.18,.03],[.09,.03],[.09,-.03]] as const
    turned(mechanics, 'PumpIntakeFlange', inletProfile, [.79,.49,0], 'x', metal)
    // Recessed bore, not a bright solid cap. No externally downloaded textures.
    cylinder(mechanics, 'PumpIntakeBore', .088, .009, [.755,.49,0], 'x', recess)
    pipe(mechanics, 'PumpOutlet', [.43,.76,0], [.43,1.29,0], .10, metal)
    turned(mechanics, 'PumpOutletFlange', [[.075,-.035],[.18,-.035],[.19,-.02],[.19,.02],[.18,.035],[.075,.035],[.075,-.035]], [.43,1.31,0], 'y', metal)
    cylinder(mechanics, 'PumpOutletBore', .073, .009, [.43,1.275,0], 'y', recess)
    instances(details, 'PumpCoolingFins', new THREE.BoxGeometry(.62,.035,.055), shell,
      Array.from({length:10},(_,i) => {
        const a = i*Math.PI/5
        return { position:[-.33,.43+Math.cos(a)*.288,Math.sin(a)*.288] as Position,rotation:[a,0,0] as Position }
      }))
    box(details, 'PumpTerminalBox', [.24,.16,.22], [-.39,.785,0], dark)
    box(details, 'PumpTerminalLid', [.27,.025,.25], [-.39,.878,0], metal)
    box(details, 'PumpNameplate', [.23,.105,.012], [-.30,.49,.315], trim)
    instances(details, 'PumpFlangeFasteners', new THREE.CylinderGeometry(.024,.024,.036,6), dark,
      Array.from({length:6},(_,i) => {
        const a = i*Math.PI/3,r=.14
        return [
          { position:[.827,.49+Math.cos(a)*r,Math.sin(a)*r] as Position, rotation:[0,0,-Math.PI/2] as Position },
          { position:[.43+Math.cos(a)*r,1.35,Math.sin(a)*r] as Position },
        ]
      }).flat())
    for (const z of [-.23,.23]) cylinder(details, 'PumpCasingBolt', .027,.035,[.60,.49,z],'x',metal,6)
    contactPatch('PumpContactShade',.78,.43)
  } else if (actualKind === 'motor') {
    feet(1.10, 0.60)
    box(body,'MotorMountCradle',[.64,.12,.48],[-.12,.15,0],dark)
    turned(body,'MotorHousing',[[0,-.54],[.29,-.54],[.345,-.47],[.345,.43],[.30,.51],[0,.51]],[-.06,.52,0])
    turned(body,'MotorRearCover',[[0,-.055],[.30,-.055],[.365,-.025],[.365,.035],[.33,.055],[0,.055]],[-.65,.52,0],'x',dark)
    turned(body,'MotorDriveCover',[[0,-.045],[.31,-.045],[.36,-.015],[.36,.025],[.28,.055],[0,.055]],[.50,.52,0],'x',metal)
    cylinder(mechanics,'MotorTerminalRiser',.13,.18,[-.18,.92,0],'y',dark)
    softBox(mechanics,'MotorTerminalBox',[.44,.36,.38],[-.18,1.11,0],shell)
    box(mechanics,'MotorTerminalLid',[.48,.045,.42],[-.18,1.315,0],metal)
    cylinder(mechanics,'MotorCableGland',.07,.14,[.11,1.11,0],'x',dark,12)
    cylinder(mechanics,'MotorDriveShaft',.09,.28,[.68,.52,0],'x',metal)
    box(mechanics,'MotorShaftKey',[.17,.026,.035],[.70,.608,0],dark)
    instances(details,'MotorCoolingFins',new THREE.BoxGeometry(.82,.035,.09),shell,
      Array.from({length:12},(_,i)=>{
        const a=i*Math.PI/6
        return {position:[-.08,.52+Math.cos(a)*.37,Math.sin(a)*.37] as Position,rotation:[a,0,0] as Position}
      }))
    instances(details,'MotorRearGrille',new THREE.BoxGeometry(.012,.025,.57),metal,
      Array.from({length:8},(_,i)=>({position:[-.711,.52,0] as Position,rotation:[i*Math.PI/8,0,0] as Position})))
    instances(details,'MotorDriveFasteners',new THREE.CylinderGeometry(.023,.023,.032,6),dark,
      Array.from({length:6},(_,i)=>{
        const a=i*Math.PI/3
        return {position:[.558,.52+Math.cos(a)*.285,Math.sin(a)*.285] as Position,rotation:[0,0,-Math.PI/2] as Position}
      }))
    turned(details,'MotorAccentBand',[[.343,-.012],[.35,-.012],[.35,.012],[.343,.012],[.343,-.012]],[.29,.52,0],'x',trim)
    box(details,'MotorNameplate',[.26,.105,.012],[-.19,.57,.421],metal)
    contactPatch('MotorContactShade',.74,.43)
  } else if (actualKind === 'compressor') {
    feet(1.30, 0.66)
    softBox(body, 'CompressorCabinet', [1.20, 1.20, 0.80], [-0.12, 0.71, 0])
    box(body,'CompressorSkirt',[1.22,.085,.82],[-.12,.15,0],dark)
    box(body, 'CompressorHood', [1.26, 0.10, 0.86], [-0.12, 1.36, 0], dark)
    turned(body,'CompressorPressureVessel',[[0,-.46],[.11,-.46],[.16,-.40],[.16,.40],[.11,.46],[0,.46]],[.62,.69,.06],'y',metal)
    cylinder(mechanics, 'CompressorVesselCap', 0.18, 0.06, [0.62, 1.18, 0.06], 'y', dark)
    pipe(mechanics, 'CompressorRiser', [-0.35, 1.36, 0], [-0.35, 1.54, 0])
    pipe(mechanics, 'CompressorTopPipe', [-0.35, 1.54, 0], [0.62, 1.54, 0])
    pipe(mechanics, 'CompressorVesselPipe', [0.62, 1.54, 0], [0.62, 1.20, 0.06])
    cylinder(mechanics, 'CompressorValve', 0.10, 0.045, [0.78, 1.20, 0.06], 'x', trim)
    instances(details,'CompressorVentSlots',new THREE.BoxGeometry(.062,.48,.018),recess,
      Array.from({length:8},(_,i)=>({position:[-.57+i*.11,.60,.415] as Position})))
    box(details,'CompressorDoorSeam',[.012,1.02,.012],[.24,.73,.407],dark)
    box(details,'CompressorDoorHandle',[.035,.19,.035],[.17,.96,.436],metal)
    box(details,'CompressorControlPanel',[.29,.20,.024],[-.39,1.06,.42],dark)
    box(details,'CompressorControlDisplay',[.18,.055,.008],[-.39,1.10,.438],metal)
    instances(details,'CompressorControlButtons',new THREE.CylinderGeometry(.018,.018,.012,10),metal,
      [-.47,-.39,-.31].map(x=>({position:[x,1.015,.442] as Position,rotation:[Math.PI/2,0,0] as Position})))
    ring(details, 'CompressorGaugeRim', 0.105, 0.022, [0.19, 1.15, 0.43], 'z', metal)
    cylinder(details, 'CompressorGauge', 0.092, 0.015, [0.19, 1.15, 0.44], 'z', shell)
    const needle=box(details,'CompressorGaugeNeedle',[.009,.065,.008],[.175,1.168,.453],dark)
    needle.rotation.z=-.5
    box(details, 'CompressorIdentification', [0.48, 0.075, 0.02], [-0.22, 1.20, 0.415], trim)
    contactPatch('CompressorContactShade',.78,.44)
  } else {
    feet(1.05, 0.60)
    softBox(body, 'GenericCabinet', [1.20, 1.02, 0.85], [0, 0.58, 0])
    box(body,'GenericLowerPlinth',[1.22,.075,.84],[0,.12,0],dark)
    softBox(body, 'GenericUpperHousing', [0.48, 0.34, 0.60], [-0.20, 1.26, 0], dark)
    pipe(mechanics, 'GenericSideRiser', [0.69, 0.25, 0], [0.69, 1.00, 0], 0.065)
    pipe(mechanics, 'GenericSideConnection', [0.51, 1.00, 0], [0.69, 1.00, 0], 0.065)
    pipe(mechanics, 'GenericHandleLeft', [-0.37, 1.43, 0], [-0.37, 1.54, 0], 0.035, dark)
    pipe(mechanics, 'GenericHandleRight', [-0.03, 1.43, 0], [-0.03, 1.54, 0], 0.035, dark)
    pipe(mechanics, 'GenericHandleTop', [-0.37, 1.54, 0], [-0.03, 1.54, 0], 0.035, dark)
    box(details,'GenericServicePanel',[.98,.76,.015],[0,.60,.433],metal)
    instances(details,'GenericVentSlots',new THREE.BoxGeometry(.58,.026,.022),recess,
      Array.from({length:5},(_,i)=>({position:[.03,.38+i*.095,.451] as Position})))
    box(details, 'GenericIdentification', [0.40, 0.085, 0.012], [0.06, 0.89, 0.449], trim)
    instances(details,'GenericPanelFasteners',new THREE.CylinderGeometry(.025,.025,.024,6),dark,
      [-.43,.43].flatMap(x=>[.28,.92].map(y=>({position:[x,y,.453] as Position,rotation:[Math.PI/2,0,0] as Position}))))
    contactPatch('GenericContactShade',.74,.46)
  }

  let meshes = 0, vertices = 0, triangles = 0
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    meshes++
    const copies = object instanceof THREE.InstancedMesh ? object.count : 1
    vertices += object.geometry.getAttribute('position').count * copies
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3 * copies
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
    // The camera spring has a small residual tail. The footprint must shrink
    // with progress too, otherwise a 35%-wide flat platform lingers after the body.
    base.scale.set(b, Math.max(0.001, b), b)
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

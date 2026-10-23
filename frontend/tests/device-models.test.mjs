import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const source = await readFile(new URL('../src/features/factory/growth/models.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } }).outputText
  .replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`)
const { buildDeviceModel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const kinds = ['pump', 'motor', 'compressor', 'generic']
const resources = root => {
  const geometry = new Set(), materials = new Set(), meshes = []
  root.traverse(node => {
    if (!node.isMesh) return
    meshes.push(node); geometry.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
  })
  return { geometry, materials, meshes }
}
const snapshot = model => {
  model.root.updateMatrixWorld(true)
  return [model.root, ...Object.values(model.stages)].map(node => ({ visible: node.visible, matrix: node.matrixWorld.toArray() }))
}

test('four real Three models have distinct three-dimensional structures, restrained budgets and normalized bounds', () => {
  const silhouettes = new Set()
  for (const kind of kinds) {
    const model = buildDeviceModel(kind, '#768D9E', true)
    assert.ok(model.root instanceof THREE.Group)
    assert.equal(model.root.visible, false)
    model.applyProgress(1)
    const { meshes, geometry, materials } = resources(model.root)
    assert.equal(model.stats.meshes, meshes.length)
    assert.equal(model.stats.geometries, geometry.size)
    assert.equal(model.stats.materials, materials.size)
    assert.ok(model.stats.triangles > 100 && model.stats.triangles < 18000)
    for (const group of Object.values(model.stages)) assert.ok(group.children.length > 0)
    const bounds = new THREE.Box3().setFromObject(model.turntable, true)
    for (const axis of ['x', 'z']) {
      assert.ok(bounds.min[axis] >= -0.85, `${kind} minimum ${axis}: ${bounds.min[axis]}`)
      assert.ok(bounds.max[axis] <= 0.85, `${kind} maximum ${axis}: ${bounds.max[axis]}`)
    }
    assert.ok(bounds.min.y >= -1e-6, `${kind} below platform`)
    assert.ok(bounds.max.y >= 1.3 && bounds.max.y <= 1.65, `${kind} height: ${bounds.max.y}`)
    assert.ok(bounds.getSize(new THREE.Vector3()).z > 0.6)
    silhouettes.add(meshes.filter(mesh => mesh.parent !== model.stages.base).map(mesh =>
      [mesh.geometry.type, mesh.geometry.getAttribute('position').count, ...mesh.position.toArray(), ...mesh.rotation.toArray().slice(0, 3)]).flat().join(','))
    assert.ok(meshes.every(mesh => !mesh.castShadow && !mesh.receiveShadow && !mesh.material.map))
    for (const item of geometry) for (const key of ['position', 'normal'])
      assert.ok([...item.getAttribute(key).array].every(Number.isFinite), `${kind} finite ${key}`)
    model.dispose()
  }
  assert.equal(silhouettes.size, 4)
})

test('platform reference top reproduces all actual SVG corners and stays at Y=0 throughout growth', () => {
  const model = buildDeviceModel('pump', '#768D9E', false)
  const platform = model.stages.base.getObjectByName('SharedReferencePlatform')
  const positions = platform.geometry.getAttribute('position')
  const expected = [[0, -35], [103, 19], [0, 74], [-103, 19]]
  for (const [x, y] of expected) {
    let found = false
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getY(i)) > 1e-7) continue
      const X = positions.getX(i), Z = positions.getZ(i)
      if (Math.hypot(51.5 * (X - Z) - x, 19.5 + 27.25 * (X + Z) - y) < 1e-5) found = true
    }
    assert.ok(found, `missing SVG corner ${x},${y}`)
  }
  const normal = platform.geometry.getAttribute('normal')
  assert.ok(Array.from({ length: normal.count }, (_, i) => normal.getY(i)).some(y => y > 0.99))
  for (const p of [0.01, 0.07, 0.14, 0.28, 0.75, 1]) {
    model.applyProgress(p)
    const bounds = new THREE.Box3().setFromObject(platform, true)
    assert.ok(Math.abs(bounds.max.y) < 1e-7)
    assert.ok(bounds.min.y < 0 && bounds.min.y >= -0.081)
  }
  model.dispose()
})

test('growth stages have independent connection pivots and reversible windows, not root scaling', () => {
  const model = buildDeviceModel('compressor', '#768D9E', false)
  const { base, body, mechanics, details } = model.stages
  assert.ok(body.position.y !== mechanics.position.y && mechanics.position.y !== details.position.y)
  model.applyProgress(0.12)
  assert.equal(base.visible, true); assert.equal(body.visible, false); assert.equal(mechanics.visible, false)
  model.applyProgress(0.32)
  assert.equal(body.visible, true); assert.equal(mechanics.visible, false); assert.equal(details.visible, false)
  model.applyProgress(0.54)
  assert.equal(mechanics.visible, true); assert.equal(details.visible, false)
  model.applyProgress(0.82)
  assert.equal(details.visible, true)
  for (const group of [base, body, mechanics, details]) assert.ok(group.scale.y > 0)
  assert.deepEqual(model.root.scale.toArray(), [1, 1, 1])
  model.applyProgress(1)
  for (const group of Object.values(model.stages)) assert.deepEqual(group.scale.toArray(), [1, 1, 1])
  const platformMatrix = base.matrixWorld.clone()
  model.turntable.rotation.y = 0.7
  model.root.updateMatrixWorld(true)
  assert.deepEqual(base.matrixWorld.toArray(), platformMatrix.toArray())
  assert.notDeepEqual(body.matrixWorld.toArray(), new THREE.Matrix4().toArray())
  model.dispose()
})

test('collapsing platform footprint continuously reaches zero without a lingering flat base', () => {
  for (const kind of kinds) {
    const model = buildDeviceModel(kind, '#768D9E', true)
    const platform = model.stages.base.getObjectByName('SharedReferencePlatform')
    const footprint = () => {
      model.root.updateMatrixWorld(true)
      return new THREE.Box3().setFromObject(platform, true).getSize(new THREE.Vector3())
    }
    model.applyProgress(1)
    const full = footprint()
    let previous = full.clone()
    for (const p of [0.03, 0.01, 0.001, 0.00001]) {
      model.applyProgress(p)
      const size = footprint()
      for (const axis of ['x', 'z']) {
        assert.ok(size[axis] < previous[axis], `${kind}/${p}: footprint must keep shrinking`)
        if (p <= 0.01) assert.ok(size[axis] < full[axis] * 0.01, `${kind}/${p}: no fixed-size footprint in the spring tail`)
      }
      previous = size
    }
    model.applyProgress(0.01)
    const collapsed = snapshot(model)
    model.applyProgress(0.4)
    model.applyProgress(0.01)
    assert.deepEqual(snapshot(model), collapsed, 'reversing growth must reuse the same platform pose')
    model.applyProgress(0)
    assert.equal(model.root.visible, false)
    assert.equal(model.stages.base.visible, false)
    model.applyProgress(1)
    assert.deepEqual(footprint().toArray(), full.toArray())
    model.dispose()
  }
})

test('interruption sampling is deterministic, preserves user yaw and retains the exact geometry/resources', () => {
  for (const kind of kinds) {
    const model = buildDeviceModel(kind, '#768D9E', false)
    const held = resources(model.root)
    const arrays = [...held.geometry].map(geometry => geometry.getAttribute('position').array)
    model.turntable.rotation.y = -0.42
    model.applyProgress(0.63)
    const first = snapshot(model)
    for (const p of [1, 0.2, 0.85, 0.01, 0.9, 0.4, 0.63]) model.applyProgress(p)
    assert.deepEqual(snapshot(model), first)
    assert.equal(model.turntable.rotation.y, -0.42)
    assert.deepEqual([...resources(model.root).geometry], [...held.geometry])
    assert.ok([...held.geometry].every((geometry, i) => geometry.getAttribute('position').array === arrays[i]))
    for (const p of [-10, NaN, Infinity, 0]) { model.applyProgress(p); assert.equal(model.root.visible, false) }
    model.applyProgress(10)
    assert.equal(model.root.visible, true)
    for (const group of Object.values(model.stages)) assert.deepEqual(group.scale.toArray(), [1, 1, 1])
    model.dispose()
  }
})

test('accent edits are local and dispose releases every owned resource exactly once, including unmounted models', () => {
  const a = buildDeviceModel('pump', '#112233', false), b = buildDeviceModel('pump', '#112233', false)
  const ar = resources(a.root), br = resources(b.root)
  assert.ok([...ar.geometry].every(value => !br.geometry.has(value)))
  assert.ok([...ar.materials].every(value => !br.materials.has(value)))
  const before = [...ar.materials].map(value => value.color.getHexString())
  a.setAccent('#FF7733')
  const after = [...ar.materials].map(value => value.color.getHexString())
  assert.equal(after.filter((value, i) => value !== before[i]).length, 1)
  assert.deepEqual([...br.materials].map(value => value.color.getHexString()), before)
  a.setAccent('url(bad)')
  assert.ok([...ar.materials].some(value => value.color.getHexString() === '7d96aa'))
  const counts = new Map([...ar.geometry, ...ar.materials].map(value => [value, 0]))
  for (const value of counts.keys()) value.addEventListener('dispose', () => counts.set(value, counts.get(value) + 1))
  const scene = new THREE.Scene(); scene.add(a.root)
  a.dispose(); a.dispose(); a.applyProgress(1); a.setAccent('#FFFFFF')
  assert.equal(a.root.parent, null)
  assert.equal(a.root.visible, false)
  assert.equal(a.root.children.length, 0)
  assert.ok([...counts.values()].every(count => count === 1))
  assert.equal(b.root.children.length, 2)
  b.dispose()
})

test('refined pump keeps real open flange bores, supported housings and shared fastener resources', () => {
  const model = buildDeviceModel('pump', '#768D9E', true)
  model.applyProgress(1)
  model.root.updateMatrixWorld(true)
  for (const name of ['PumpIntakeFlange', 'PumpOutletFlange']) {
    const flange = model.root.getObjectByName(name)
    const positions = flange.geometry.getAttribute('position')
    // The local lathe axis is Y. A true flange has no triangles closing the bore.
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Math.hypot(positions.getX(i), positions.getZ(i)) > .07, `${name} bore must remain open`)
    }
  }
  for (const [housing, support] of [['PumpMotor', 'PumpMotorCradle'], ['PumpCasing', 'PumpCasingCradle']]) {
    const body = new THREE.Box3().setFromObject(model.root.getObjectByName(housing), true)
    const cradle = new THREE.Box3().setFromObject(model.root.getObjectByName(support), true)
    assert.ok(body.intersectsBox(cradle), `${housing} must have a connected support`)
  }
  const fasteners = model.root.getObjectByName('PumpFlangeFasteners')
  assert.ok(fasteners instanceof THREE.InstancedMesh)
  assert.equal(fasteners.count, 12)
  assert.ok([...fasteners.instanceMatrix.array].every(Number.isFinite))
  assert.ok(model.stats.triangles < 4000, 'industrial detailing must retain the existing pump triangle budget')
  const resourcesBefore = resources(model.root)
  for (let i = 0; i < 100; i++) model.applyProgress((i % 10) / 9)
  assert.deepEqual(resources(model.root).geometry, resourcesBefore.geometry)
  model.dispose()
})

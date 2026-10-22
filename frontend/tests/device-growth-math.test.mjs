import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import { Matrix3, Matrix4, OrthographicCamera, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three'

async function load(name) {
  const source = await readFile(new URL(`../src/features/factory/growth/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { relativeAffine, projectDevicePoint, configureDeviceCamera } = await load('projection')
const { GrowthMotion } = await load('growthMotion')
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const viewBox = { x: 0, y: 0, width: 900, height: 660 }
const matrix3 = value => new Matrix3().set(value.a, value.c, value.e, value.b, value.d, value.f, 0, 0, 1)
const affine = value => ({ a: value.elements[0], b: value.elements[1], c: value.elements[3], d: value.elements[4], e: value.elements[6], f: value.elements[7] })
const apply = (value, point) => ({ x: value.a * point.x + value.c * point.y + value.e, y: value.b * point.x + value.d * point.y + value.f })
function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
}
function samePoint(actual, expected, epsilon = 1e-8) { close(actual.x, expected.x, epsilon); close(actual.y, expected.y, epsilon) }
function seedRandom(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
}
function randomAffine(random) {
  const angle = random() * Math.PI * 2
  const x = .15 + random() * 2.4, y = .15 + random() * 2.4, shear = (random() - .5) * 2
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  return { a: cosine * x, b: sine * x, c: cosine * shear - sine * y, d: sine * shear + cosine * y,
    e: (random() - .5) * 3000, f: (random() - .5) * 3000 }
}
function cameraCSS(camera, point, width, height) {
  const ndc = new Vector3(point.x, point.y, point.z).project(camera)
  return { x: (ndc.x + 1) * width / 2, y: (1 - ndc.y) * height / 2 }
}

test('relative affine reintroduces meet letterboxing/viewBox offsets after cancelling shared ancestor CTMs', () => {
  const viewport = { x: 13, y: -21, width: 900, height: 660 }
  const width = 1300, height = 620
  const scale = Math.min(width / viewport.width, height / viewport.height)
  const V = { a: scale, b: 0, c: 0, d: scale, e: (width - scale * viewport.width) / 2 - scale * viewport.x,
    f: (height - scale * viewport.height) / 2 - scale * viewport.y }
  const common = { a: 1.2, b: .4, c: -.3, d: .8, e: 700, f: -85 }
  const local = { a: 1.4, b: .15, c: .3, d: .8, e: 310, f: 207 }
  for (const ancestor of [common, { ...common, a: -common.a, b: -common.b }]) {
    const S = affine(matrix3(ancestor).multiply(matrix3(V)))
    const G = affine(matrix3(S).multiply(matrix3(local)))
    const C = relativeAffine(S, G, viewport, width, height)
    assert.ok(C)
    for (const point of [{ x: 0, y: 0 }, { x: 103, y: 74 }, { x: -50, y: 20 }]) {
      samePoint(apply(C, point), apply(V, apply(local, point)))
    }
  }
})

test('1000 fixed-seed real Three matrix inverses match V * inverse(S) * G', () => {
  const random = seedRandom(20261023)
  for (let index = 0; index < 1000; index++) {
    const S = randomAffine(random), G = randomAffine(random)
    const width = 200 + random() * 1600, height = 180 + random() * 1000
    const vb = { x: (random() - .5) * 60, y: (random() - .5) * 60, width: 800 + random() * 300, height: 500 + random() * 400 }
    const k = Math.min(width / vb.width, height / vb.height)
    const V = new Matrix3().set(k, 0, (width - k * vb.width) / 2 - k * vb.x, 0, k, (height - k * vb.height) / 2 - k * vb.y, 0, 0, 1)
    const expected = V.multiply(matrix3(S).invert()).multiply(matrix3(G))
    const C = relativeAffine(S, G, vb, width, height)
    assert.ok(C)
    const point = { x: random() * 200 - 100, y: random() * 200 - 100 }
    const reference = new Vector3(point.x, point.y, 1).applyMatrix3(expected)
    samePoint(apply(C, point), reference)
  }
})

test('projection rejects reflections, singular/nonfinite matrices and invalid sizes explicitly', () => {
  const reflected = { ...identity, a: -1 }
  const singular = { ...identity, a: 1, b: 1, c: 1, d: 1 + 1e-14 }
  assert.equal(relativeAffine(identity, reflected, viewBox, 900, 660), null)
  assert.equal(relativeAffine(singular, identity, viewBox, 900, 660), null)
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.equal(relativeAffine(identity, identity, viewBox, bad, 660), null)
    assert.equal(relativeAffine(identity, identity, { ...viewBox, height: bad }, 900, 660), null)
    assert.equal(configureDeviceCamera(new OrthographicCamera(), identity, 900, bad), false)
  }
  for (const bad of [reflected, singular, { ...identity, e: NaN }, { ...identity, d: Infinity }]) {
    const camera = new OrthographicCamera()
    camera.position.set(3, 4, 5)
    const projection = camera.projectionMatrix.clone()
    assert.equal(configureDeviceCamera(camera, bad, 900, 660), false)
    assert.deepEqual(camera.position.toArray(), [3, 4, 5])
    assert.ok(camera.projectionMatrix.equals(projection))
    assert.throws(() => projectDevicePoint(bad, { x: 0, y: 0, z: 0 }), RangeError)
  }
  assert.throws(() => projectDevicePoint(identity, { x: 0, y: NaN, z: 0 }), RangeError)
  assert.equal(configureDeviceCamera(new OrthographicCamera(), { ...identity, a: 1e-160, d: 1e-160 }, 900, 660), false)
  assert.equal(configureDeviceCamera(new OrthographicCamera(), { ...identity, a: 1e-140, d: 1e-140, e: 1e307 }, 900, 660), false)
})

test('1000 random affine cameras project 3D points and all four original SVG corners exactly', () => {
  const random = seedRandom(20261022)
  const corners = [{ x: -103, y: 19 }, { x: 0, y: -35 }, { x: 103, y: 19 }, { x: 0, y: 74 }]
  const camera = new OrthographicCamera()
  for (let index = 0; index < 1000; index++) {
    const C = randomAffine(random), width = 240 + random() * 1700, height = 180 + random() * 1100
    assert.equal(configureDeviceCamera(camera, C, width, height), true)
    for (let sample = 0; sample < 3; sample++) {
      const point = { x: random() * 4 - 2, y: random() * 2, z: random() * 4 - 2 }
      samePoint(cameraCSS(camera, point, width, height), projectDevicePoint(C, point))
    }
    for (const corner of corners) {
      const ground = { x: (corner.x / 51.5 + (corner.y - 19.5) / 27.25) / 2, y: 0,
        z: (-corner.x / 51.5 + (corner.y - 19.5) / 27.25) / 2 }
      samePoint(cameraCSS(camera, ground, width, height), apply(C, corner))
    }
  }
})

test('default Three world updates keep view rigid, custom projection/inverse stable, and raycasting aligned', () => {
  const camera = new OrthographicCamera()
  const C = { a: 1.8, b: .35, c: .6, d: .7, e: 472, f: 281 }
  const width = 1280, height = 740
  assert.equal(configureDeviceCamera(camera, C, width, height), true)
  const projection = camera.projectionMatrix.clone()
  for (let index = 0; index < 4; index++) {
    camera.updateMatrixWorld(true)
    camera.updateWorldMatrix(true, false)
    assert.ok(camera.projectionMatrix.equals(projection))
    const scale = new Vector3()
    camera.matrixWorld.decompose(new Vector3(), new Quaternion(), scale)
    scale.toArray().forEach(value => close(value, 1, 1e-12))
    const inverseCheck = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.projectionMatrixInverse)
    inverseCheck.elements.forEach((value, element) => close(value, element % 5 === 0 ? 1 : 0, 1e-10))
    const point = new Vector3(.47, .8, -.31)
    const roundtrip = point.clone().project(camera).unproject(camera)
    close(roundtrip.distanceTo(point), 0, 1e-10)
    samePoint(cameraCSS(camera, point, width, height), projectDevicePoint(C, point))
  }
  const target = new Vector3(.64, 0, -.25)
  const ndc = target.clone().project(camera)
  const ray = new Raycaster()
  ray.setFromCamera(new Vector2(ndc.x, ndc.y), camera)
  const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())
  assert.ok(hit)
  close(hit.distanceTo(target), 0, 1e-10)
})

function bounded(motion) {
  assert.ok(Number.isFinite(motion.p) && motion.p >= 0 && motion.p <= 1)
  assert.ok(Number.isFinite(motion.v) && Math.abs(motion.v) <= 1.2 + 1e-12)
}
function finish(motion, dt = 1000 / 60) {
  let frames = 0
  while (motion.tick(dt)) { bounded(motion); assert.ok(++frames < 10000, 'motion must finitely converge') }
  bounded(motion)
  return (frames + 1) * dt
}

test('growth arrives in roughly one second, stays bounded and ends exactly stationary', () => {
  const motion = new GrowthMotion()
  assert.equal(motion.tick(16), false)
  motion.request('A')
  assert.deepEqual([motion.activeId, motion.requestedId, motion.p, motion.v, motion.phase], ['A', 'A', 0, 0, 'growing'])
  const duration = finish(motion)
  assert.ok(duration >= 900 && duration <= 1200, String(duration))
  assert.deepEqual([motion.p, motion.v, motion.phase], [1, 0, 'expanded'])
  assert.equal(motion.tick(100), false)
  motion.request(null)
  const collapseDuration = finish(motion)
  assert.ok(collapseDuration >= 900 && collapseDuration <= 1200)
  assert.deepEqual([motion.activeId, motion.requestedId, motion.p, motion.v, motion.phase], [null, null, 0, 0, 'idle'])
})

test('same-ID requests do not reset progress or velocity; A -> B -> A reverses the retained A', () => {
  const motion = new GrowthMotion()
  motion.request('A'); motion.tick(480)
  const before = [motion.p, motion.v]
  motion.request('A')
  assert.deepEqual([motion.p, motion.v], before)
  motion.request('B')
  assert.deepEqual([motion.p, motion.v], before)
  assert.equal(motion.activeId, 'A')
  motion.tick(180)
  assert.ok(motion.p > 0 && motion.v < 0)
  const reversal = [motion.p, motion.v]
  motion.request('A')
  assert.deepEqual([motion.p, motion.v], reversal)
  assert.equal(motion.phase, 'growing')
  motion.tick(10)
  assert.ok(motion.p < reversal[0] && motion.v > reversal[1], 'momentum decelerates before direction reverses')
  assert.equal(motion.activeId, 'A')
  finish(motion)
  assert.deepEqual([motion.activeId, motion.requestedId, motion.p, motion.v, motion.phase], ['A', 'A', 1, 0, 'expanded'])
})

test('a new visual identity is adopted only at the zero seam and only the latest request grows', () => {
  const motion = new GrowthMotion()
  motion.request('A'); finish(motion)
  motion.request('B'); motion.tick(120); motion.request('C')
  let switched = false
  for (let frame = 0; frame < 3000; frame++) {
    const previous = { id: motion.activeId, p: motion.p }
    const active = motion.tick(1)
    bounded(motion)
    assert.notEqual(motion.activeId, 'B')
    if (previous.id === 'A' && motion.activeId === 'C') {
      switched = true
      assert.ok(previous.p <= .002 && motion.p <= .002)
    }
    if (!active) break
  }
  assert.equal(switched, true)
  assert.deepEqual([motion.activeId, motion.requestedId, motion.p, motion.v], ['C', 'C', 1, 0])
})

test('fixed-seed rapid retargets preserve interruption position/velocity and finitely settle to latest', () => {
  const random = seedRandom(1327)
  const motion = new GrowthMotion()
  motion.request('A')
  for (let index = 0; index < 500; index++) {
    motion.tick(1 + random() * 90)
    bounded(motion)
    const before = [motion.p, motion.v]
    const id = ['A', 'B', 'C', null][Math.floor(random() * 4)]
    const retained = motion.p > 0
    motion.request(id)
    if (retained) assert.deepEqual([motion.p, motion.v], before)
    bounded(motion)
  }
  motion.request('FINAL')
  finish(motion)
  assert.deepEqual([motion.activeId, motion.requestedId, motion.p, motion.v, motion.phase], ['FINAL', 'FINAL', 1, 0, 'expanded'])
})

test('invalid dt is nonmutating; huge finite dt substeps safely; frame rates remain bounded', () => {
  const motion = new GrowthMotion()
  motion.request('A'); motion.tick(300)
  const before = [motion.activeId, motion.p, motion.v, motion.phase]
  for (const dt of [0, -10, NaN, Infinity, -Infinity]) {
    assert.equal(motion.tick(dt), true)
    assert.deepEqual([motion.activeId, motion.p, motion.v, motion.phase], before)
  }
  assert.equal(motion.tick(1e15), false)
  assert.deepEqual([motion.p, motion.v], [1, 0])
  for (const dt of [1, 1000 / 144, 1000 / 60, 100, 500, 2000]) {
    const instance = new GrowthMotion()
    instance.request('A'); finish(instance, dt)
    instance.request(null); finish(instance, dt)
    assert.deepEqual([instance.activeId, instance.p, instance.v, instance.phase], [null, 0, 0, 'idle'])
  }
})

test('reduced motion and reset produce exact stable states without queued resurrection', () => {
  const motion = new GrowthMotion()
  motion.request('A'); motion.tick(250)
  motion.request('B', true)
  assert.deepEqual([motion.activeId, motion.p, motion.v, motion.phase], ['B', 1, 0, 'expanded'])
  motion.request('C'); motion.tick(100)
  assert.equal(motion.tick(NaN, true), false)
  assert.deepEqual([motion.activeId, motion.p, motion.v, motion.phase], ['C', 1, 0, 'expanded'])
  motion.request(null, true)
  assert.deepEqual([motion.activeId, motion.p, motion.v, motion.phase], [null, 0, 0, 'idle'])
  motion.request('A'); motion.tick(120); motion.reset()
  assert.deepEqual([motion.activeId, motion.requestedId, motion.p, motion.v, motion.phase], [null, null, 0, 0, 'idle'])
  assert.equal(motion.tick(1000), false)
})

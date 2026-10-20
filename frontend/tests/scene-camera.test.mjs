import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = await readFile(new URL('../src/services/sceneCamera.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } })
const { zoomAt, boundCamera } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
test('anchored zoom preserves the world point under the pointer', () => {
  const before = { x: 20, y: -30, zoom: 1.2 }, anchor = { x: 245, y: 230 }
  const after = zoomAt(before, 1.25, anchor)
  assert.ok(Math.abs((anchor.x-450-before.x)/before.zoom - (anchor.x-450-after.x)/after.zoom) < 1e-8)
  assert.ok(Math.abs((anchor.y-330-before.y)/before.zoom - (anchor.y-330-after.y)/after.zoom) < 1e-8)
})
test('camera bounds prevent losing all scene content and cap pinch scale', () => {
  assert.deepEqual(boundCamera({ x: 9999, y: -9999, zoom: 30 }), { x: 560, y: -420, zoom: 2.1 })
  assert.equal(zoomAt({ x: 0, y: 0, zoom: .6 }, .01, {x:450,y:330}).zoom, .6)
})

const { pinchCamera } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
test('two fingers moving ten units pan ten units, including separately delivered pointer events', () => {
  const before = { x: 20, y: -30, zoom: 1.2 }
  const first = { x: 400, y: 300 }, second = { x: 500, y: 300 }
  const movedFirst = { x: 410, y: 310 }, movedSecond = { x: 510, y: 310 }
  const together = pinchCamera(before, [first, second], [movedFirst, movedSecond])
  assert.deepEqual(together, { x: 30, y: -20, zoom: 1.2 })
  const intermediate = pinchCamera(before, [first, second], [movedFirst, second])
  const after = pinchCamera(intermediate, [movedFirst, second], [movedFirst, movedSecond])
  assert.ok(Math.abs(after.x - 30) < 1e-8)
  assert.ok(Math.abs(after.y + 20) < 1e-8)
  assert.ok(Math.abs(after.zoom - 1.2) < 1e-8)
})

test('pinch preserves the original world point under the moving centroid', () => {
  const before = { x: 20, y: -30, zoom: 1.2 }
  const oldCenter = { x: 250, y: 260 }, newCenter = { x: 280, y: 280 }
  const after = pinchCamera(before,
    [{ x: 200, y: 260 }, { x: 300, y: 260 }],
    [{ x: 215, y: 280 }, { x: 345, y: 280 }])
  assert.ok(Math.abs((oldCenter.x - 450 - before.x) / before.zoom - (newCenter.x - 450 - after.x) / after.zoom) < 1e-8)
  assert.ok(Math.abs((oldCenter.y - 330 - before.y) / before.zoom - (newCenter.y - 330 - after.y) / after.zoom) < 1e-8)
  assert.ok(Math.abs(after.zoom - 1.56) < 1e-8)
})

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

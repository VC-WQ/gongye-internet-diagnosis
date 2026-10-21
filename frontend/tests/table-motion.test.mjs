import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = await readFile(new URL('../src/motion/tableRowMotion.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText
const { tableRowStart } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
test('retained rows start from their actual previous position, including interrupted transform', () => {
  assert.deepEqual(tableRowStart(180, 60, -34, 0.8), { y: 86, opacity: 0.8 })
  assert.equal(60 + tableRowStart(180, 60, -34).y, 180 - 34)
  assert.deepEqual(tableRowStart(60, 180, 48), { y: -72, opacity: 1 })
})
test('ordinary refresh stays still while new identities enter without retained stale records', () => {
  assert.equal(tableRowStart(100, 100), undefined)
  assert.deepEqual(tableRowStart(undefined, 100), { y: 8, opacity: 0 })
  assert.equal(tableRowStart(NaN, 100), undefined)
  assert.equal(tableRowStart(100, Infinity), undefined)
  assert.equal(tableRowStart(100, 100, NaN), undefined)
})

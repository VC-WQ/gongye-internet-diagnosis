import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

// Exercise the shipped route mapper with Node's test runner.
const source = await readFile(
  new URL('../src/services/workspaceMode.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022 },
})
const { modeFromPath } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

test('workspace mode maps every primary route', () => {
  assert.equal(modeFromPath('/'), 'overview')
  assert.equal(modeFromPath('/dashboard'), 'overview')
  assert.equal(modeFromPath('/devices'), 'devices')
  assert.equal(modeFromPath('/device/pump-001'), 'device')
  assert.equal(modeFromPath('/diagnose'), 'diagnose')
  assert.equal(modeFromPath('/events'), 'events')
  assert.equal(modeFromPath('/reports'), 'reports')
  assert.equal(modeFromPath('/lab'), 'lab')
  assert.equal(modeFromPath('/ops'), 'ops')
  assert.equal(modeFromPath('/admin'), 'admin')
  assert.equal(modeFromPath('/admin/users'), 'admin')
  assert.equal(modeFromPath('/unknown'), 'unknown')
})

test('trailing slashes do not change workspace mode', () => {
  for (const [path, mode] of [
    ['/dashboard/', 'overview'],
    ['/devices/', 'devices'],
    ['/diagnose/', 'diagnose'],
    ['/events/', 'events'],
    ['/reports/', 'reports'],
  ]) {
    assert.equal(modeFromPath(path), mode)
  }
})

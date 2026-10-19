import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/features/pico/core/actions.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022 },
})
const { actionPath, isSafeInternalPath, ALLOWED_ACTIONS } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

test('only navigation actions are allowlisted', () => {
  assert.deepEqual(
    [...ALLOWED_ACTIONS].sort(),
    ['open_device', 'open_event', 'open_report', 'switch_workspace_view'].sort(),
  )
})

test('open_event builds an internal path with device and event', () => {
  assert.equal(
    actionPath({
      type: 'open_event',
      label: '',
      target: '1',
      params: { device_id: 'pump-001', event_id: 1 },
    }),
    '/events?device=pump-001&event=1',
  )
})

test('open_report and open_device build internal paths', () => {
  assert.equal(
    actionPath({
      type: 'open_report',
      label: '',
      target: '1',
      params: { device_id: 'pump-001', event_id: '1' },
    }),
    '/reports?device=pump-001&event=1',
  )
  assert.equal(
    actionPath({
      type: 'open_device',
      label: '',
      target: 'pump-001',
      params: {},
    }),
    '/device/pump-001',
  )
})

test('external URLs are rejected by workspace switches', () => {
  for (const target of ['https://evil.example', '//evil.example', 'javascript:alert(1)']) {
    assert.equal(
      actionPath({
        type: 'switch_workspace_view',
        label: '',
        target,
        params: {},
      }),
      null,
    )
  }
  assert.equal(
    actionPath({
      type: 'switch_workspace_view',
      label: '',
      target: '/events',
      params: {},
    }),
    '/events',
  )
  assert.equal(isSafeInternalPath('/events'), true)
  assert.equal(isSafeInternalPath('//evil.example'), false)
})

test('unknown action types are rejected', () => {
  assert.equal(
    actionPath({
      type: 'execute',
      label: '',
      target: '1',
      params: {},
    }),
    null,
  )
})

test('workspace navigation rejects encoded backslashes, control text and write/admin destinations', () => {
 for (const target of ['/\\evil.example', '/%5cevil.example', '/events\n', '/admin/records', '/api/v1/command-loop/events/1/execute', '/%ZZ']) {
  assert.equal(isSafeInternalPath(target), false)
 }
 assert.equal(isSafeInternalPath('/dashboard?view=reports&device=pump-001&event=1'), true)
})

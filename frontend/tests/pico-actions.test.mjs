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

const params = (path) => new URL(path, 'http://localhost').searchParams

test('only navigation actions are allowlisted', () => {
  assert.deepEqual(
    [...ALLOWED_ACTIONS].sort(),
    ['open_device', 'open_event', 'open_report', 'switch_workspace_view'].sort(),
  )
})

test('open_event builds a factory panel path with device and event', () => {
  const path = actionPath({
    type: 'open_event',
    label: '',
    target: '1',
    params: { device_id: 'pump-001', event_id: 1 },
  })
  assert.ok(path.startsWith('/dashboard?'))
  assert.equal(params(path).get('panel'), 'events')
  assert.equal(params(path).get('device'), 'pump-001')
  assert.equal(params(path).get('event'), '1')
})

test('open_report and open_device build factory panel paths', () => {
  const report = actionPath({
    type: 'open_report',
    label: '',
    target: '1',
    params: { device_id: 'pump-001', event_id: '1' },
  })
  assert.equal(params(report).get('panel'), 'report')
  assert.equal(params(report).get('device'), 'pump-001')
  assert.equal(params(report).get('event'), '1')

  const device = actionPath({
    type: 'open_device',
    label: '',
    target: 'pump-001',
    params: {},
  })
  assert.equal(params(device).get('panel'), 'device')
  assert.equal(params(device).get('device'), 'pump-001')
})

test('legacy Pico action targets are migrated to the four domains', () => {
  const target = (path) =>
    actionPath({
      type: 'switch_workspace_view',
      label: '',
      target: path,
      params: {},
    })
  assert.equal(params(target('/events')).get('panel'), 'events')
  assert.equal(params(target('/reports')).get('panel'), 'report')
  assert.equal(params(target('/diagnose')).get('panel'), 'diagnosis')
  assert.equal(target('/lab'), '/about/research/signal')
  assert.equal(target('/ops?tab=eval'), '/tools/evaluation')
  assert.equal(target('/ops?tab=threshold'), '/tools/settings')
  assert.equal(target('/dashboard?device=pump-001'), '/dashboard?device=pump-001')
})

test('external, management and write destinations are rejected', () => {
  for (const target of [
    'https://evil.example',
    '//evil.example',
    'javascript:alert(1)',
    '/admin/records',
    '/api/v1/command-loop/events/1/execute',
  ]) {
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
  for (const target of [
    '/\\evil.example',
    '/%5cevil.example',
    '/dashboard\n',
    '/admin/records',
    '/api/v1/command-loop/events/1/execute',
    '/%ZZ',
  ]) {
    assert.equal(isSafeInternalPath(target), false)
  }
  assert.equal(
    isSafeInternalPath('/dashboard?device=pump-001&panel=report&event=1'),
    true,
  )
  assert.equal(isSafeInternalPath('/tools/pico'), true)
  assert.equal(isSafeInternalPath('/about/research/signal'), true)
})

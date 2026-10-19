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

const { canonicalWorkspacePath, viewFromLocation, workspaceLink, transitionWorkspacePath } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function query(path) { return new URL(path, 'http://localhost').searchParams }

test('all six modes run under the same workspace URL and match Pico context', () => {
  for (const view of ['scene', 'devices', 'device', 'diagnose', 'events', 'reports']) {
    const search = `?view=${view}&device=pump-001&event=12`
    assert.equal(viewFromLocation('/dashboard', search), view)
    assert.equal(modeFromPath('/dashboard', search), view === 'scene' ? 'overview' : view)
    assert.equal(canonicalWorkspacePath('/dashboard', search), `/dashboard${search}`)
  }
})

test('legacy deep links preserve device, event, valid filters and panel parameters', () => {
  for (const [path, view] of [['/devices', 'devices'], ['/diagnose', 'diagnose'], ['/events', 'events'], ['/reports', 'reports']]) {
    const result = canonicalWorkspacePath(path, '?device=compressor-001&event=9&q=air&status=fault&page=2&tab=history&channel=temperature')
    const params = query(result)
    assert.equal(params.get('view'), view)
    for (const [key, value] of Object.entries({ device: 'compressor-001', event: '9', q: 'air', status: 'fault', page: '2', tab: 'history', channel: 'temperature' }))
      assert.equal(params.get(key), value)
    const parsed = new URL(result, 'http://localhost')
    assert.equal(canonicalWorkspacePath(parsed.pathname, parsed.search), result, 'redirect must be idempotent')
  }
})

test('device path identity wins and special characters survive exactly once', () => {
  const result = canonicalWorkspacePath('/device/' + encodeURIComponent('pump / A'), '?device=wrong&event=5&tab=acoustic')
  assert.equal(query(result).get('device'), 'pump / A')
  assert.equal(query(result).get('tab'), 'acoustic')
  assert.equal(query(result).get('event'), '5')
  assert.equal(query(workspaceLink('/device/' + encodeURIComponent('pump / A'))).get('device'), 'pump / A')
})

test('legacy diagnosis report and trajectory links retain the intended read view', () => {
  assert.equal(query(canonicalWorkspacePath('/diagnose', '?tab=report&event=8')).get('view'), 'reports')
  const timeline = query(canonicalWorkspacePath('/diagnose', '?tab=trajectory&device=pump-001&event=8'))
  assert.equal(timeline.get('view'), 'events')
  assert.equal(timeline.get('tab'), 'timeline')
  assert.equal(timeline.get('event'), '8')
})

test('mode changes isolate filters and never resurrect a previous device or event', () => {
  const result = query(transitionWorkspacePath('devices', '?view=events&device=pump-002&event=19&page=4&tab=timeline', 'view=devices&device=pump-001&event=6&q=motor&status=offline&page=2'))
  assert.equal(result.get('device'), 'pump-002')
  assert.equal(result.get('event'), '19')
  assert.equal(result.get('q'), 'motor')
  assert.equal(result.get('page'), '2')
  assert.equal(result.get('status'), 'offline')
  assert.equal(result.has('tab'), false)
  const cleared = query(transitionWorkspacePath('reports', '?view=devices', 'device=old&event=6'))
  assert.equal(cleared.has('device'), false)
  assert.equal(cleared.has('event'), false)
})

test('invalid URL state normalizes safely without routing management into ordinary reports', () => {
  const result = query(canonicalWorkspacePath('/dashboard', '?view=wrong&event=-2&page=NaN&redirect=https://example.com'))
  assert.equal(result.get('view'), 'scene')
  assert.equal(result.has('event'), false)
  assert.equal(result.has('page'), false)
  assert.equal(result.has('redirect'), false)
  assert.equal(canonicalWorkspacePath('/admin/records', '?device=pump-001'), undefined)
  assert.equal(canonicalWorkspacePath('/unknown'), undefined)
  assert.equal(query(canonicalWorkspacePath('/device/%E0%A4%A', '')).has('device'), false)
})

import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/features/pico/core/context.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } })
const { buildPicoContext, picoContextFingerprint, withPicoOverride, validatedPicoFocus, canCommitPicoResponse } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

const input = (extra = {}) => ({ area: 'factory', pathname: '/dashboard', search: '', contextRevision: 1, ...extra })
const key = (extra) => picoContextFingerprint(buildPicoContext(input(extra)))

test('factory snapshot keeps an empty selection empty and ignores arbitrary URL input', () => {
  const snapshot = buildPicoContext(input({ search: '?q=password123&token=secret&password=x&device=not-a-workspace-selection' }))
  assert.deepEqual(snapshot, { area: 'factory', route: '/dashboard', visible_section: 'factory_overview', context_revision: 1 })
  const serialized = JSON.stringify(snapshot)
  for (const secret of ['password123', 'secret', 'not-a-workspace-selection']) assert.equal(serialized.includes(secret), false)
})

test('device detail sends its actual analysis tab and workspace identity', () => {
  const snapshot = buildPicoContext(input({ area: 'admin', pathname: '/manage/devices/motor-001', deviceId: 'motor-001', search: '?device=wrong&detail=acoustic' }))
  assert.equal(snapshot.device_id, 'motor-001')
  assert.equal(snapshot.route, '/manage/devices/motor-001')
  assert.equal(snapshot.active_tab, 'acoustic')
  assert.equal(snapshot.visible_section, 'device_detail')
  assert.equal(buildPicoContext(input({ pathname: '/manage/devices/motor-001', search: '?detail=unsupported' })).active_tab, 'realtime')
})

test('read-only record and event/report tasks retain the correct visible identity', () => {
  const record = buildPicoContext(input({ area: 'admin', pathname: '/manage/records/7', eventId: 7 }))
  assert.equal(record.event_id, 7)
  assert.equal(record.visible_section, 'record_detail')
  const task = buildPicoContext(input({ area: 'tools', pathname: '/tools/events', eventId: 7, search: '?section=report&tab=timeline' }))
  assert.equal(task.visible_section, 'report')
  assert.equal(task.active_tab, undefined)
  assert.equal(buildPicoContext(input({ pathname: '/tools/events', search: '?tab=timeline' })).active_tab, 'timeline')
  for (const eventId of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(buildPicoContext(input({ eventId })).event_id, undefined)
})

test('research topic and point are represented without copying arbitrary search fields', () => {
  const context = buildPicoContext(input({ area: 'research', pathname: '/research/health/rul', search: '?q=private-text&password=x' }))
  assert.equal(context.visible_section, 'research:health')
  assert.equal(context.active_tab, 'rul')
  assert.equal(context.route, '/research/health/rul')
})

test('all meaningful same-area page changes invalidate context, including a business refresh', () => {
  assert.notEqual(key({ area: 'tools', pathname: '/tools/events' }), key({ area: 'tools', pathname: '/tools/diagnosis' }))
  assert.notEqual(key({ pathname: '/tools/events' }), key({ pathname: '/tools/events', search: '?section=report' }))
  assert.notEqual(key({ pathname: '/tools/events' }), key({ pathname: '/tools/events', search: '?tab=timeline' }))
  assert.notEqual(key({ area: 'research', pathname: '/research/health/rul' }), key({ area: 'research', pathname: '/research/health/xjtu' }))
  assert.notEqual(key({ deviceId: 'motor-001' }), key({ deviceId: 'pump-001' }))
  assert.notEqual(key({ contextRevision: 1 }), key({ contextRevision: 2 }))
  assert.equal(key({ search: '?token=one' }), key({ search: '?token=two' }))
})

test('explicit override is immutable and never carries the previous device event across', () => {
  const current = buildPicoContext(input({ deviceId: 'motor-001', eventId: 7 }))
  const target = withPicoOverride(current, { device_id: 'pump-001' })
  assert.equal(target.device_id, 'pump-001')
  assert.equal(target.event_id, undefined)
  assert.equal(current.device_id, 'motor-001')
  assert.equal(current.event_id, 7)
  assert.deepEqual(withPicoOverride(current, { device_id: 'pump-001', event_id: 8 }), { ...target, event_id: 8 })
})

test('conversation focus only preserves validated structured entity fields', () => {
  assert.deepEqual(validatedPicoFocus({ device_id: 'pump-001', event_id: 7, token: 'never-forward' }), { device_id: 'pump-001', event_id: 7 })
  assert.equal(validatedPicoFocus({ device_id: '', event_id: -1 }), undefined)
  assert.equal(validatedPicoFocus({ device_id: 'x'.repeat(65), event_id: 1.5 }), undefined)
  assert.equal(validatedPicoFocus(null), undefined)
})

test('late or reordered responses cannot commit after page, request or revision changes', () => {
  const gate = { requestId: 4, currentRequestId: 4, fingerprint: key({ deviceId: 'motor-001' }), currentFingerprint: key({ deviceId: 'motor-001' }), revision: 1, responseRevision: 1 }
  assert.equal(canCommitPicoResponse(gate), true)
  assert.equal(canCommitPicoResponse({ ...gate, currentRequestId: 5 }), false)
  assert.equal(canCommitPicoResponse({ ...gate, currentFingerprint: key({ deviceId: 'pump-001' }) }), false)
  assert.equal(canCommitPicoResponse({ ...gate, responseRevision: 2 }), false)
  // An older compatible server has no revision field; request and snapshot gates still apply.
  assert.equal(canCommitPicoResponse({ ...gate, responseRevision: undefined }), true)
})

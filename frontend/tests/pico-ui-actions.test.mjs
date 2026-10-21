import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const code = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const catalogue = code(await read('../src/features/about/research.ts'))
const actionsUrl = code((await read('../src/features/pico/core/uiActions.ts')).replace("'../../about/research'", JSON.stringify(catalogue)))
const { parsePicoUiAction, picoUiActionPath, PicoExecutionGuard } = await import(actionsUrl)
const { PicoActionExecutor } = await import(code((await read('../src/features/pico/core/PicoActionExecutor.ts')).replace("'./uiActions'", JSON.stringify(actionsUrl))))
const { DeviceFormDraftChannel } = await import(code(await read('../src/features/management/deviceFormDraft.ts')))
const action = (type, extra = {}) => ({ type, action_id: 'unit-action', ...extra })
const nav = (route_id, params = {}) => action('navigate', { route_id, params })
const form = fields => action('prefill_device_form', { mode: 'create', fields })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('runtime protocol accepts only explicit routes, exact properties and real research points', () => {
  assert.ok(parsePicoUiAction(nav('research', { topic_id: 'health', point_id: 'rul' })))
  assert.ok(parsePicoUiAction(form({ id: 'motor-008', name: '驱动电机 C', health_score: 92 })))
  for (const raw of [nav('//evil'), nav('factory', { url: '//evil' }), nav('research', { topic_id: 'health', point_id: 'fpcnn' }), nav('research', { point_id: 'rul' }), nav('device_detail', { device_id: '../admin/users' }), nav('event_detail', { event_id: true }), nav('event_detail', { event_id: Number.MAX_SAFE_INTEGER + 1 }), action('set_theme', { theme: 'dark', script: 'bad' }), action('set_theme', { theme: null }), { ...form({}), action_id: 'x'.repeat(65) }, form({ id: 'motor 008' }), form({ health_score: '92' }), form({ health_score: NaN }), form({ health_score: Infinity }), form({ health_score: 101 }), form({ threshold: 5 }), form({ device_type: 'unknown' }), form({ name: ' ' }), form({ name: 'x'.repeat(129) }), { ...form({ id: 'motor-008' }), mode: 'edit', device_id: 'motor-001' }]) assert.equal(parsePicoUiAction(raw), null, JSON.stringify(raw))
})

test('operation paths use canonical V2.3 routes and strict event/analysis identities', () => {
  assert.equal(picoUiActionPath(nav('device_detail', { device_id: 'motor-001', tab: 'acoustic' })), '/manage/devices/motor-001?detail=acoustic')
  assert.equal(picoUiActionPath(nav('event_detail', { event_id: 7 })), '/manage/records/7')
  assert.equal(picoUiActionPath(nav('research', { topic_id: 'health', point_id: 'rul' })), '/research/health/rul')
  assert.equal(picoUiActionPath(nav('report', { event_id: 7, device_id: 'pump-002' })), '/tools/events?event=7&section=report&device=pump-002')
})

function fixture(overrides = {}) {
  const state = { key: 'origin', url: '/dashboard', theme: 'light', dockOpen: true, deviceId: undefined }
  const calls = []
  const deps = { current: () => state, navigate: path => { calls.push(['navigate', path]); state.url = path; state.key = 'new'; state.deviceId = path.split('/devices/')[1]?.split('?')[0] }, setTheme: theme => { calls.push(['theme', theme]); state.theme = theme }, closeDock: () => { state.dockOpen = false; calls.push(['close']) }, getMe: async () => ({ role: 'admin', is_active: true }), getDevice: async id => ({ id }), getEvent: async id => ({ id, device_id: 'motor-001' }), offerDraft: async draft => { calls.push(['draft', draft]); return { missing: ['设备类型'] } }, ...overrides }
  return { state, calls, deps, executor: new PicoActionExecutor(deps), guard: () => new PicoExecutionGuard('origin', '/dashboard') }
}

test('executor waits for actual route commit and prevents duplicate execution', async () => {
  const f = fixture()
  f.deps.navigate = path => { f.calls.push(['navigate', path]); setTimeout(() => { f.state.url = path; f.state.key = 'new' }, 75) }
  let done = false
  const result = f.executor.execute(nav('research'), new AbortController().signal, f.guard()).then(r => { done = true; return r })
  await sleep(20); assert.equal(done, false)
  assert.equal((await result).status, 'succeeded')
  assert.equal((await f.executor.execute(nav('research'), new AbortController().signal, f.guard())).status, 'rejected')
  assert.equal(f.calls.filter(c => c[0] === 'navigate').length, 1)
})

test('theme execution reports only committed theme without requiring admin', async () => {
  const f = fixture({ getMe: async () => { throw new Error('must not call') } })
  const result = await f.executor.execute(action('set_theme', { theme: 'dark' }), new AbortController().signal, f.guard())
  assert.equal(f.state.theme, 'dark'); assert.equal(result.status, 'succeeded'); assert.match(result.message, /已切换/)
})

test('ordinary or inactive accounts cannot open a draft through stale client privileges', async () => {
  for (const user of [{ role: 'user', is_active: true }, { role: 'admin', is_active: false }]) {
    const f = fixture({ getMe: async () => user })
    assert.equal((await f.executor.execute(form({ id: 'motor-008' }), new AbortController().signal, f.guard())).status, 'failed')
    assert.deepEqual(f.calls, [])
  }
})

test('prefill merges explicit fields via acknowledgement and never submits a write', async () => {
  const f = fixture()
  const result = await f.executor.execute(form({ id: 'motor-008', name: '驱动电机 C', health_score: 92 }), new AbortController().signal, f.guard())
  assert.equal(result.status, 'succeeded'); assert.match(result.message, /尚未保存.*设备类型/)
  assert.deepEqual(f.calls.map(c => c[0]), ['close', 'navigate', 'draft'])
  const draft = f.calls[2][1]
  assert.equal(draft.fields.health_score, 92); assert.equal('device_type' in draft.fields, false)
})

test('missing or mismatched entities fail before navigation rather than declaring success', async () => {
  for (const getDevice of [async () => { throw new Error('目标不存在') }, async () => ({ id: 'wrong-device' })]) {
    const f = fixture({ getDevice })
    const result = await f.executor.execute(nav('device_detail', { device_id: 'motor-001' }), new AbortController().signal, f.guard())
    assert.equal(result.status, 'failed'); assert.deepEqual(f.calls, [])
  }
  const f = fixture()
  assert.equal((await f.executor.execute(nav('report', { event_id: 7, device_id: 'pump-002' }), new AbortController().signal, f.guard())).status, 'failed')
  assert.deepEqual(f.calls, [])
})

test('external page changes during permission checks cancel rather than prefill a new page', async () => {
  let resolve
  const f = fixture({ getMe: () => new Promise(r => { resolve = r }) })
  const pending = f.executor.execute(form({ health_score: 92 }), new AbortController().signal, f.guard())
  f.state.url = '/research'; resolve({ role: 'admin', is_active: true })
  assert.equal((await pending).status, 'cancelled'); assert.deepEqual(f.calls, [])
})

test('abort interrupts a stalled permission check without waiting for a transport timeout', async () => {
  const f = fixture({ getMe: () => new Promise(() => {}) })
  const controller = new AbortController()
  const pending = f.executor.execute(form({ health_score: 92 }), controller.signal, f.guard())
  controller.abort()
  assert.equal((await pending).status, 'cancelled'); assert.deepEqual(f.calls, [])
})

test('execution guard permits its own destination but not an unrelated URL in the revision gap', () => {
  const guard = new PicoExecutionGuard('origin', '/dashboard')
  assert.equal(guard.accept('origin', '/dashboard?q=changed'), false)
  guard.target = '/manage/devices/motor-001'
  assert.equal(guard.accept('new', guard.target), true)
  assert.equal(guard.accept('new', '/manage/devices/pump-002'), false)
})

test('draft channel acknowledges once, keeps identity and clears listeners on abort/timeout', async () => {
  const channel = new DeviceFormDraftChannel()
  let emissions = 0
  const unsubscribe = channel.subscribe(() => { emissions++ })
  const first = { actionId: 'one', mode: 'create', fields: { health_score: 92 } }
  const pending = channel.offer(first, new AbortController().signal, 100)
  channel.acknowledge('wrong-id', { missing: [] })
  assert.equal(channel.getSnapshot(), first)
  channel.acknowledge('one', { missing: ['设备类型'] })
  assert.deepEqual(await pending, { missing: ['设备类型'] })
  channel.acknowledge('one', { missing: [] })
  assert.equal(channel.getSnapshot(), first)
  channel.release('one'); assert.equal(channel.getSnapshot(), undefined)
  const controller = new AbortController()
  const aborted = channel.offer({ ...first, actionId: 'two' }, controller.signal, 100)
  controller.abort(); await assert.rejects(aborted, { name: 'AbortError' })
  assert.equal(channel.getSnapshot(), undefined)
  await assert.rejects(channel.offer({ ...first, actionId: 'three' }, new AbortController().signal, 10), /未准备完成/)
  assert.equal(channel.getSnapshot(), undefined)
  unsubscribe(); const count = emissions; channel.clear(); assert.equal(emissions, count)
})

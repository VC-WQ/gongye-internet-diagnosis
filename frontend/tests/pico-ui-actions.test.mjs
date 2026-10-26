import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const code = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const catalogue = code(await read('../src/features/about/research.ts'))
const actionsUrl = code((await read('../src/features/pico/core/uiActions.ts')).replace("'../../about/research'", JSON.stringify(catalogue)))
const { parsePicoUiAction, picoUiActionPath, picoNavigationIdentity, PicoExecutionGuard } = await import(actionsUrl)
const workspaceUrl = code(await read('../src/services/workspaceMode.ts'))
const { PicoActionExecutor } = await import(code((await read('../src/features/pico/core/PicoActionExecutor.ts')).replace("'./uiActions'", JSON.stringify(actionsUrl)).replace("'../../../services/workspaceMode'", JSON.stringify(workspaceUrl))))
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

test('factory actions preserve literal search and clear device context before selecting a real visible entity', async () => {
  const f=fixture({factoryDeviceVisible:id=>id==='pump-002'})
  Object.assign(f.state,{url:'/dashboard?device=motor-001&status=healthy&q=old&channel=current',deviceId:'motor-001'})
  const guard=f.guard()
  assert.equal((await f.executor.execute(action('set_factory_filter',{status:'degraded',q:' 泵 '}),new AbortController().signal,guard)).status,'succeeded')
  const url=new URL(f.state.url,'http://localhost');assert.equal(url.searchParams.get('q'),' 泵 ');assert.equal(url.searchParams.get('device'),null);assert.equal(url.searchParams.get('channel'),null)
  assert.equal((await f.executor.execute({...action('select_factory_device',{device_id:'pump-002'}),action_id:'select-visible'},new AbortController().signal,guard)).status,'succeeded')
  assert.equal(f.state.deviceId,'pump-002')
  assert.equal((await f.executor.execute({...action('select_factory_device',{device_id:'motor-001'}),action_id:'reject-hidden'},new AbortController().signal,guard)).status,'failed')
})

test('report navigation binds the validated owner before committing a self-navigation guard',async()=>{
  const f=fixture()
  const guard=f.guard()
  const result=await f.executor.execute(nav('report',{event_id:7}),new AbortController().signal,guard)
  assert.equal(result.status,'succeeded');assert.equal(new URL(f.state.url,'http://localhost').searchParams.get('device'),'motor-001');assert.equal(guard.accept(f.state),true)
})

function fixture(overrides = {}) {
  const state = { key: 'origin', url: '/dashboard', locationKey: 'page-0', sessionToken: 'test-session-A', theme: 'light', dockOpen: true, deviceId: undefined, eventId: undefined }
  const calls = []
  let navigation = 0
  const commit = (path, marker) => Object.assign(state, { url: path, key: `context-${++navigation}`, locationKey: `page-${navigation}`, navigationMarker: marker, ...picoNavigationIdentity(path) })
  const deps = { current: () => state, navigate: (path, marker, signal) => { if (!signal.aborted) { calls.push(['navigate', path]); commit(path, marker) } }, setTheme: theme => { calls.push(['theme', theme]); state.theme = theme }, closeDock: () => { state.dockOpen = false; calls.push(['close']) }, getMe: async () => ({ role: 'admin', is_active: true }), getDevice: async id => ({ id }), getEvent: async id => ({ id, device_id: 'motor-001' }), offerDraft: async draft => { calls.push(['draft', draft]); return { missing: ['设备类型'] } }, ...overrides }
  return { state, calls, deps, commit, executor: new PicoActionExecutor(deps), guard: () => new PicoExecutionGuard({ ...state }) }
}

test('executor waits for actual route commit and prevents duplicate execution', async () => {
  const f = fixture()
  f.deps.navigate = (path, marker) => { f.calls.push(['navigate', path]); setTimeout(() => f.commit(path, marker), 75) }
  let done = false
  const result = f.executor.execute(nav('research'), new AbortController().signal, f.guard()).then(r => { done = true; return r })
  await sleep(20); assert.equal(done, false)
  assert.equal((await result).status, 'succeeded')
  assert.equal((await f.executor.execute(nav('research'), new AbortController().signal, f.guard())).status, 'rejected')
  assert.equal(f.calls.filter(c => c[0] === 'navigate').length, 1)
})

test('theme execution reports only committed theme without requiring admin', async () => {
  let checks = 0
  const f = fixture({ getMe: async () => { checks++; return { role: 'user', is_active: true } } })
  const result = await f.executor.execute(action('set_theme', { theme: 'dark' }), new AbortController().signal, f.guard())
  assert.equal(f.state.theme, 'dark'); assert.equal(result.status, 'succeeded'); assert.match(result.message, /已切换/); assert.equal(checks, 1)
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

test('execution guard consumes only the exact self-navigation and rejects same-URL identity/account changes', () => {
  const f = fixture(), guard = f.guard()
  assert.equal(guard.accept({ ...f.state, url: '/dashboard?q=changed' }), false)
  guard.beginNavigation('/manage/devices/motor-001', 'self-navigation')
  const arrived = { ...f.state, key: 'new', url: '/manage/devices/motor-001', locationKey: 'page-1', navigationMarker: 'self-navigation', deviceId: 'motor-001' }
  assert.equal(guard.accept({ ...arrived, deviceId: 'pump-002' }), false)
  assert.equal(guard.accept({ ...arrived, sessionToken: 'test-session-B' }), false)
  assert.equal(guard.accept({ ...arrived, navigationMarker: undefined }), false)
  assert.equal(guard.accept(arrived), true)
  assert.equal(guard.accept({ ...arrived, key: 'effect-revision' }), true)
  assert.equal(guard.completeNavigation(arrived), true)
  assert.equal(guard.accept({ ...arrived, key: 'external-revision' }), false)
  assert.equal(guard.accept({ ...arrived, deviceId: 'pump-002' }), false)
  assert.equal(guard.accept({ ...arrived, locationKey: 'different-history-entry' }), false)
})

const unique = (value, id) => ({ ...value, action_id: id })
test('three-step sequence preserves order, real permissions and canonical tab/filter/diagnosis routes', async () => {
  let permissions = 0
  const devices = []
  const f = fixture({ getMe: async () => { permissions++; return { role: 'user', is_active: true } }, getDevice: async id => { devices.push(id); return { id } } })
  const steps = [unique(nav('tools', { tool: 'diagnosis', device_id: 'pump-002' }), 'prepare'), unique(nav('records', { device_id: 'pump-002' }), 'filter'), unique(nav('device_detail', { device_id: 'pump-002', tab: 'events' }), 'detail')]
  const results = await f.executor.executeSequence(steps, new AbortController().signal, f.guard())
  assert.deepEqual(results.map(result => result.status), ['succeeded', 'succeeded', 'succeeded'])
  assert.deepEqual(f.calls.map(call => call[1]), ['/tools/diagnosis?device=pump-002', '/manage/records?device=pump-002', '/manage/devices/pump-002?detail=events'])
  assert.match(results[0].message, /尚未提交诊断/)
  assert.equal(permissions, 3)
  assert.deepEqual(devices, ['pump-002', 'pump-002', 'pump-002'])
})

test('entire sequence is validated before side effects, including unknown fields, duplicate IDs and excessive steps', async () => {
  for (const values of [
    [unique(action('set_theme', { theme: 'dark' }), 'first'), unique(nav('factory', { script: 'bad' }), 'bad')],
    [nav('research'), nav('factory')],
    Array.from({ length: 4 }, (_, index) => unique(nav('research'), `step-${index}`)),
    [nav('tools', { tool: 'simulation', device_id: 'pump-002' })],
    [nav('records', { device_id: 'pump-002', sort: 'invented' })],
    [unique(form({ id: 'motor-008' }), 'draft'), unique(nav('research'), 'leave-form')],
  ]) {
    const f = fixture()
    const results = await f.executor.executeSequence(values, new AbortController().signal, f.guard())
    assert.equal(results[0].status, 'rejected'); assert.deepEqual(f.calls, [])
  }
})

test('failure stops the sequence and preserves completed and unexecuted step results', async () => {
  const f = fixture({ getDevice: async () => ({ id: 'wrong' }) })
  const progress = []
  const results = await f.executor.executeSequence([
    unique(action('set_theme', { theme: 'dark' }), 'first'),
    unique(nav('device_detail', { device_id: 'pump-002' }), 'missing'),
    unique(action('set_theme', { theme: 'light' }), 'last'),
  ], new AbortController().signal, f.guard(), value => progress.push(value))
  assert.deepEqual(results.map(result => result.status), ['succeeded', 'failed', 'cancelled'])
  assert.deepEqual(f.calls, [['theme', 'dark']])
  assert.match(results[2].message, /本步未执行/)
  assert.deepEqual(progress.at(-1), results)
})

test('same URL with an external device change cancels in-flight entity validation', async () => {
  let resolve
  const f = fixture({ getDevice: () => new Promise(done => { resolve = done }) })
  const guard = f.guard()
  const pending = f.executor.execute(nav('device_detail', { device_id: 'motor-001' }), new AbortController().signal, guard)
  await sleep(0)
  f.state.deviceId = 'pump-002'
  resolve({ id: 'motor-001' })
  assert.equal((await pending).status, 'cancelled'); assert.deepEqual(f.calls, [])
})

test('user cancellation after one completed step prevents subsequent steps', async () => {
  const f = fixture(), controller = new AbortController()
  const results = await f.executor.executeSequence([
    unique(action('set_theme', { theme: 'dark' }), 'first'), unique(nav('research'), 'second'), unique(nav('factory'), 'third'),
  ], controller.signal, f.guard(), progress => { if (progress[0]?.status === 'succeeded') controller.abort() })
  assert.deepEqual(results.map(result => result.status), ['succeeded', 'cancelled', 'cancelled'])
  assert.deepEqual(f.calls, [['theme', 'dark']])
})

test('an account token change between steps never continues with new credentials', async () => {
  const f = fixture()
  const results = await f.executor.executeSequence([
    unique(action('set_theme', { theme: 'dark' }), 'first'), unique(nav('research'), 'second'),
  ], new AbortController().signal, f.guard(), progress => { if (progress[0]?.status === 'succeeded') f.state.sessionToken = 'test-session-B' })
  assert.deepEqual(results.map(result => result.status), ['succeeded', 'cancelled'])
  assert.deepEqual(f.calls, [['theme', 'dark']])
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

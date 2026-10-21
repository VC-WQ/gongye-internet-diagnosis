import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import axios from 'axios'
import ts from 'typescript'

const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
globalThis.sessionStorage = { setItem: (key, value) => storage.set(`session:${key}`, value) }
const redirects = []
globalThis.window = { location: { pathname: '/dashboard', search: '', assign: path => redirects.push(path) } }
const source = await readFile(new URL('../src/services/api.ts', import.meta.url), 'utf8')
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
outputText = outputText.replace("'axios'", JSON.stringify(import.meta.resolve('axios')))
const { default: api, cancelAuthenticatedRequests } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

function deferredRequest() {
  let started
  const ready = new Promise(resolve => { started = resolve })
  let complete
  api.defaults.adapter = config => new Promise((resolve, reject) => {
    complete = {
      config,
      success: () => resolve({ status: 200, statusText: 'OK', headers: {}, config, data: { ok: true } }),
      unauthorized: () => reject(new axios.AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined, { status: 401, statusText: 'Unauthorized', headers: {}, config, data: {} })),
    }
    started(complete)
  })
  return { ready, get complete() { return complete } }
}

test('logout aborts all old-session requests, including callers with their own signal', async () => {
  storage.set('token', 'old-session')
  const caller = new AbortController()
  const firstAdapter = deferredRequest()
  const first = api.get('/devices', { signal: caller.signal }).catch(error => error)
  const one = await firstAdapter.ready
  const secondAdapter = deferredRequest()
  const second = api.get('/auth/me').catch(error => error)
  const two = await secondAdapter.ready
  storage.delete('token')
  cancelAuthenticatedRequests()
  assert.equal(one.config.signal.aborted, true)
  assert.equal(two.config.signal.aborted, true)
  assert.equal(caller.signal.aborted, false, 'logout must not mutate a caller-owned controller')
  one.unauthorized(); two.success()
  assert.equal(axios.isCancel(await first), true)
  assert.equal(axios.isCancel(await second), true)
  assert.deepEqual(redirects, [], 'late old-session 401 must not hard-navigate over C')
})

test('a caller abort still reaches the combined authenticated request', async () => {
  storage.set('token', 'current-session')
  const caller = new AbortController()
  const adapter = deferredRequest()
  const pending = api.get('/devices', { signal: caller.signal }).catch(error => error)
  const request = await adapter.ready
  caller.abort()
  assert.equal(request.config.signal.aborted, true)
  request.success()
  assert.equal(axios.isCancel(await pending), true)
})

test('settled requests release their caller abort listener and are not cancelled later', async () => {
  storage.set('token', 'current-session')
  const caller = new AbortController()
  let added = 0, removed = 0
  const add = caller.signal.addEventListener.bind(caller.signal)
  const remove = caller.signal.removeEventListener.bind(caller.signal)
  caller.signal.addEventListener = (...args) => { added++; return add(...args) }
  caller.signal.removeEventListener = (...args) => { removed++; return remove(...args) }
  const adapter = deferredRequest()
  const pending = api.get('/devices', { signal: caller.signal })
  const request = await adapter.ready
  request.success()
  await pending
  assert.equal(added, 1)
  assert.equal(removed, 1)
  cancelAuthenticatedRequests()
  assert.equal(request.config.signal.aborted, false)
})

test('an old 401 cannot clear a newer token, but a current-session 401 retains expiry behavior', async () => {
  redirects.length = 0
  storage.set('token', 'session-A')
  const oldAdapter = deferredRequest()
  const old = api.get('/devices').catch(error => error)
  const previous = await oldAdapter.ready
  storage.set('token', 'session-B')
  previous.unauthorized()
  await old
  assert.equal(storage.get('token'), 'session-B')
  assert.deepEqual(redirects, [])
  const currentAdapter = deferredRequest()
  const current = api.get('/devices').catch(error => error)
  const request = await currentAdapter.ready
  request.unauthorized()
  await current
  assert.equal(storage.has('token'), false)
  assert.deepEqual(redirects, ['/login'])
  assert.equal(storage.get('session:auth:returnTo'), '/dashboard')
})

import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const code = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const tokens = code(await read('../src/motion/tokens.ts'))
const coordinator = code(await read('../src/motion/coordinator.ts'))
const flush = code('export const flushSync = callback => callback()')
// No browser globals while importing: the route controller's permanent browser
// listeners belong to integration tests, not these isolated cancellation cases.
const { transitionRoute, notifyRouteReady } = await import(code((await read('../src/motion/routeMotion.ts'))
  .replace("'react-dom'", JSON.stringify(flush)).replace("'./coordinator'", JSON.stringify(coordinator)).replace("'./tokens'", JSON.stringify(tokens))))
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function browser() {
  const captures = [], styles = new Set()
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.window = { location: { pathname: '/dashboard', search: '' } }
  globalThis.document = {
    documentElement: { dataset: {} },
    getElementById: () => null,
    createElement: () => ({ dataset: {}, isConnected: false, remove() { this.isConnected = false; styles.delete(this) } }),
    head: { append(node) { node.isConnected = true; styles.add(node) } },
    startViewTransition(update) {
      let finish
      const capture = { update, skipped: 0, ready: Promise.resolve(), finished: new Promise(resolve => { finish = resolve }), skipTransition() { this.skipped++; finish() }, finish: () => finish() }
      captures.push(capture)
      return capture
    },
  }
  const commit = (key, path, onCommit) => () => {
    onCommit()
    window.location.pathname = path
    notifyRouteReady({ key, pathname: path, search: '' })
  }
  return { captures, styles, commit }
}
const from = { key: 'origin', pathname: '/dashboard', search: '' }

test('aborted queued navigation never commits and releases its captured visual work', async () => {
  const f = browser(), signal = new AbortController()
  let commits = 0
  transitionRoute(f.commit('research', '/research', () => commits++), from, '/research', signal.signal)
  assert.equal(f.captures.length, 1)
  signal.abort()
  await f.captures[0].update()
  await tick()
  assert.equal(commits, 0)
  assert.equal(f.captures[0].skipped, 1)
  assert.equal(f.styles.size, 0)
  assert.equal(document.documentElement.dataset.routeTransition, undefined)
})

test('an old aborted signal cannot cancel the newer user navigation ticket', async () => {
  const f = browser(), old = new AbortController()
  const commits = []
  transitionRoute(f.commit('old', '/research', () => commits.push('old')), from, '/research', old.signal)
  transitionRoute(f.commit('new', '/tools', () => commits.push('new')), from, '/tools')
  old.abort()
  await f.captures[0].update()
  assert.equal(f.captures[1].skipped, 0)
  await f.captures[1].update()
  f.captures[1].finish()
  await tick()
  assert.deepEqual(commits, ['new'])
  assert.equal(f.styles.size, 0)
})

test('a signal already aborted cannot create a capture or interrupt an existing route', async () => {
  const f = browser(), stopped = new AbortController()
  stopped.abort()
  let commits = 0
  transitionRoute(f.commit('valid', '/tools', () => commits++), from, '/tools')
  transitionRoute(() => { throw new Error('must not commit') }, from, '/research', stopped.signal)
  assert.equal(f.captures.length, 1)
  assert.equal(f.captures[0].skipped, 0)
  await f.captures[0].update()
  f.captures[0].finish()
  await tick()
  assert.equal(commits, 1)
  assert.equal(f.styles.size, 0)
})

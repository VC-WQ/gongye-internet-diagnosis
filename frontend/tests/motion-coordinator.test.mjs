import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/motion/coordinator.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } })
const { MotionCoordinator } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const turns = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function browser() {
  const handles = []
  return {
    handles,
    start: update => {
      const ready = deferred(), finished = deferred()
      const handle = { ready: ready.promise, finished: finished.promise, update, skipped: 0,
        skipTransition() { handle.skipped++; ready.reject(new Error('skipped')); finished.resolve() },
        complete: () => { ready.resolve(); finished.resolve() },
      }
      handles.push(handle)
      return handle
    },
  }
}

test('a superseded browser callback cannot commit the old navigation', async () => {
  const coordinator = new MotionCoordinator(), native = browser(), commits = []
  const first = coordinator.run({ commit: () => commits.push('old') }, native.start)
  const second = coordinator.run({ commit: () => commits.push('latest') }, native.start)
  await native.handles[0].update()
  await native.handles[1].update()
  native.handles[1].complete()
  await Promise.all([first, second])
  assert.deepEqual(commits, ['latest'])
  assert.equal(native.handles[0].skipped, 1)
})

test('authentication cancellation releases a slow ready wait and invalidates late work', async () => {
  const coordinator = new MotionCoordinator(), native = browser(), ready = deferred()
  let commits = 0, presented = 0, cleanups = 0
  const done = coordinator.run({ commit: () => { commits++ }, ready: () => ready.promise,
    presented: () => { presented++ }, cleanup: () => { cleanups++ } }, native.start)
  const update = native.handles[0].update()
  await turns()
  coordinator.cancel()
  await Promise.all([done, update])
  ready.resolve()
  await turns()
  assert.equal(commits, 1)
  assert.equal(presented, 0)
  assert.equal(cleanups, 1)
})

test('a skipped visual cannot dispose a lazy readiness listener before the real route is ready', async () => {
  const coordinator = new MotionCoordinator(), native = browser(), ready = deferred()
  const presented = []
  let cleaned = false, finished = false
  const done = coordinator.run({ commit: () => {}, ready: () => ready.promise,
    presented: value => presented.push(value), cleanup: () => { cleaned = true } }, native.start)
  const update = native.handles[0].update()
  coordinator.skipVisual()
  void done.then(() => { finished = true })
  await turns()
  assert.equal(cleaned, false)
  assert.equal(finished, false)
  assert.deepEqual(presented, [])
  ready.resolve()
  await Promise.all([done, update])
  assert.deepEqual(presented, [false])
  assert.equal(cleaned, true)
})

test('unsupported or reduced-motion execution commits once and waits for actual DOM readiness', async () => {
  const coordinator = new MotionCoordinator(), ready = deferred(), presented = []
  let commits = 0
  const done = coordinator.run({ commit: () => { commits++ }, ready: () => ready.promise, presented: value => presented.push(value) })
  await turns()
  assert.equal(commits, 1)
  assert.deepEqual(presented, [])
  ready.resolve()
  await done
  assert.deepEqual(presented, [false])
})

test('a native start failure falls back without repeating a callback already invoked', async () => {
  const coordinator = new MotionCoordinator(), presented = []
  let commits = 0
  await coordinator.run({ commit: () => { commits++ }, presented: value => presented.push(value) }, update => {
    void update()
    throw new Error('capture unavailable')
  })
  assert.equal(commits, 1)
  assert.deepEqual(presented, [false])
})

test('an early rejected native handle still commits once and retains actual route readiness', async () => {
  const coordinator = new MotionCoordinator(), native = browser(), ready = deferred()
  let commits = 0, cleanups = 0
  const done = coordinator.run({ commit: () => { commits++ }, ready: () => ready.promise, cleanup: () => { cleanups++ } }, native.start)
  native.handles[0].skipTransition()
  await turns()
  assert.equal(commits, 1)
  assert.equal(cleanups, 0)
  ready.resolve()
  await done
  await native.handles[0].update()
  assert.equal(commits, 1)
  assert.equal(cleanups, 1)
})

test('finishing an obsolete handle cannot cancel or clear a newer transition', async () => {
  const coordinator = new MotionCoordinator(), native = browser(), presented = []
  const first = coordinator.run({ commit: () => {}, cleanup: () => presented.push('old-clean') }, native.start)
  const second = coordinator.run({ commit: () => {}, presented: () => presented.push('new-ready') }, native.start)
  native.handles[0].complete()
  await first
  await native.handles[1].update()
  assert.equal(native.handles[1].skipped, 0)
  native.handles[1].complete()
  await second
  assert.deepEqual(presented, ['old-clean', 'new-ready'])
})

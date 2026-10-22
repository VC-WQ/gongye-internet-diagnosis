import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/motion/loginIntro.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
const { IntroProgressChannel, LOGIN_ENTRIES, localIntroProgress, sampleLoginEntry, renderLoginEntries } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('A subscribers replay the current frame and stale epochs cannot alter a later entrance', () => {
  const channel = new IntroProgressChannel()
  const received = []
  const off = channel.subscribe(frame => received.push(frame))
  assert.deepEqual(received.at(-1), { epoch: 0, progress: 1, active: false })
  channel.begin(1)
  channel.publish(1, .62)
  channel.cancel(2)
  channel.begin(3)
  channel.publish(1, 1)
  channel.finish(1)
  channel.begin(1)
  assert.deepEqual(received.at(-1), { epoch: 3, progress: 0, active: true })
  channel.publish(3, .7)
  const late = []
  channel.subscribe(frame => late.push(frame))()
  assert.deepEqual(late, [{ epoch: 3, progress: .7, active: true }])
  channel.finish(3)
  assert.deepEqual(received.at(-1), { epoch: 3, progress: 1, active: false })
  off()
  const count = received.length
  channel.begin(4)
  assert.equal(received.length, count)
})

test('cancelled/completed A never regresses and invalid frame values stay finite', () => {
  const channel = new IntroProgressChannel()
  let frame
  channel.subscribe(value => { frame = value })
  channel.begin(1)
  for (const progress of [.5, .2, NaN, -10, Infinity]) channel.publish(1, progress)
  assert.equal(frame.progress, .5)
  channel.publish(1, 10)
  assert.equal(frame.progress, 1)
  channel.cancel(2)
  channel.publish(2, .1)
  assert.deepEqual(frame, { epoch: 2, progress: 1, active: false })
  channel.finish(2)
  channel.publish(2, .1)
  assert.equal(frame.progress, 1)
})

test('listener/diagnostic errors cannot interrupt A or other subscribers', () => {
  const errors = []
  const channel = new IntroProgressChannel(error => { errors.push(error.message); throw Error('diagnostic') })
  channel.begin(1)
  channel.subscribe(frame => { if (frame.progress > 0) throw Error('local decoration') })
  const received = []
  channel.subscribe(frame => received.push(frame.progress))
  assert.doesNotThrow(() => channel.publish(1, .5))
  assert.doesNotThrow(() => channel.finish(1))
  assert.deepEqual(errors, ['local decoration'])
  assert.deepEqual(received, [0, .5, 1])
  assert.doesNotThrow(() => channel.subscribe(() => { throw Error('late decoration') }))
  assert.deepEqual(errors, ['local decoration', 'late decoration'])
})

test('reset/StrictMode cleanup is local and a remount gets one current frame', () => {
  const channel = new IntroProgressChannel()
  let removed = 0, retained = 0
  const cleanup = channel.subscribe(() => removed++)
  channel.subscribe(() => retained++)
  cleanup(); cleanup()
  channel.cancel(1); channel.begin(1)
  assert.equal(removed, 1)
  assert.equal(retained, 3)
  channel.clear()
  channel.publish(1, .6)
  assert.equal(retained, 3)
  const remount = []
  const off = channel.subscribe(frame => remount.push(frame.progress))
  assert.deepEqual(remount, [.6])
  channel.finish(1)
  assert.deepEqual(remount, [.6, 1])
  off()
})

test('entry ranges reject invalid configuration and are monotone for every viewport', () => {
  for (const range of [[.5, .5], [.8, .2], [-1, .5], [0, 2], [NaN, 1], [0, Infinity]]) {
    assert.throws(() => localIntroProgress(.6, ...range), RangeError)
  }
  for (const mobile of [false, true]) {
    for (const entry of LOGIN_ENTRIES) {
      let previous = 0
      for (let index = 0; index <= 100; index++) {
        const frame = sampleLoginEntry(index / 100, entry, mobile)
        assert.ok(Number.isFinite(frame.y) && Number.isFinite(frame.clip))
        assert.ok(frame.opacity >= previous && frame.opacity <= 1, entry)
        previous = frame.opacity
      }
      assert.equal(sampleLoginEntry(0, entry, mobile).opacity, 0)
      assert.deepEqual(sampleLoginEntry(1, entry, mobile), { opacity: 1, y: 0, clip: 0, done: true })
    }
  }
  assert.equal(sampleLoginEntry(.5, 'heading', false).opacity, 0)
  assert.equal(sampleLoginEntry(.58, 'heading', true).opacity, 0)
  assert.ok(sampleLoginEntry(.7, 'username', false).opacity > sampleLoginEntry(.7, 'password', false).opacity)
  assert.ok(sampleLoginEntry(.85, 'password', false).opacity > sampleLoginEntry(.85, 'action', false).opacity)
})

function entry(name) {
  const style = {
    removeProperty(name) { delete this[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] },
  }
  return { dataset: { loginEntry: name }, style }
}

test('new Tab nodes read the current A frame; cancellation and reduced/static state fully clear them', () => {
  let nodes = [entry('heading'), entry('password')]
  const root = { querySelectorAll: () => nodes }
  renderLoginEntries(root, { epoch: 1, progress: .65, active: true }, false)
  assert.equal(nodes[1].style.opacity, '0')
  const oldPassword = nodes[1]
  nodes = [nodes[0], entry('password'), entry('action')]
  renderLoginEntries(root, { epoch: 1, progress: .8, active: true }, false)
  assert.ok(Number(nodes[1].style.opacity) > 0)
  assert.equal(oldPassword.style.opacity, '0', 'removed Tab DOM is not mutated by later frames')
  renderLoginEntries(root, { epoch: 2, progress: 1, active: false }, false)
  for (const node of nodes) {
    for (const property of ['opacity', 'transform', 'clipPath', 'willChange']) assert.equal(node.style[property], undefined)
  }
  renderLoginEntries(root, { epoch: 3, progress: 0, active: true }, true)
  renderLoginEntries(root, { epoch: 3, progress: 1, active: true }, true)
  assert.equal(nodes[2].style.opacity, undefined)
})

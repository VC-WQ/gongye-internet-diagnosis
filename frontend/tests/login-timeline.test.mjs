import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } })
  if (path.endsWith('loginTimeline.ts')) {
    const tokens = await readFile(new URL('../src/motion/tokens.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(tokens, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText
    outputText = outputText.replace("'./tokens'", `'data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}'`)
  }
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { sampleA, sampleB, createBTimeline, panelInsets, sampleFactoryEntrance } = await load('../src/motion/loginTimeline.ts')
const { DURATION, EASING, FACTORY_ENTRANCE } = await load('../src/motion/tokens.ts')
const geometry = { viewportWidth: 1440, redTravel: 1440 * .545 }

test('motion tokens remain positive and easing curves valid', () => {
  for (const [key, value] of Object.entries(DURATION)) assert.ok(value > 0 && value < 2, key)
  for (const [key, values] of Object.entries(EASING)) {
    assert.equal(values.length, 4, key)
    values.forEach((value) => assert.ok(value >= 0 && value <= 1, key))
  }
})
test('A translates an intact object monotonically left, with acceleration and deceleration and no overshoot', () => {
  assert.deepEqual(sampleA(0), { progress: 0, redX: 0, done: false })
  let previous = 0
  for (let i = 0; i <= 200; i++) {
    const frame = sampleA(i / 200)
    assert.ok(frame.redX <= previous && frame.redX >= -1)
    previous = frame.redX
  }
  assert.equal(sampleA(1).redX, -1)
  assert.equal(sampleA(1).done, true)
  assert.ok(Math.abs(sampleA(.01).redX) < .01)
  assert.ok(Math.abs(sampleA(.99).redX + 1) < .01)
  assert.equal('rightInset' in sampleA(.5), false, 'the cover must move, not shrink its clip')
})
test('B has three independent clocks and panel, red, paper finish in that order', () => {
  const time = createBTimeline(geometry)
  assert.ok(time.panelEnd < time.redEnd && time.redEnd < time.paperEnd)
  assert.ok(time.panelEnd / time.total < .35)
  assert.ok(time.redEnd / time.total >= .45 && time.redEnd / time.total <= .5)
  const panelEnd = sampleB(time.panelEnd, geometry)
  assert.equal(panelEnd.panelDone, true)
  assert.equal(panelEnd.panelScale, 0)
  assert.equal(panelEnd.panelOpacity, 0)
  assert.equal(panelEnd.redDone, false)
  assert.equal(panelEnd.paperDone, false)
  const redEnd = sampleB(time.redEnd, geometry)
  assert.equal(redEnd.redDone, true)
  assert.equal(redEnd.paperDone, false)
  assert.ok(redEnd.paperProgress > 0 && redEnd.paperProgress < 1)
  assert.equal(sampleB(time.total, geometry).paperDone, true)
})
test('red measured short path has no slower average speed than the full viewport paper across responsive ratios', () => {
  for (const viewportWidth of [320, 390, 768, 1280, 1440, 2560]) {
    for (const ratio of [.2, .4, .545, .7, 1]) {
      const g = { viewportWidth, redTravel: viewportWidth * ratio }
      const time = createBTimeline(g)
      assert.ok(time.redTravel / time.redDuration >= time.paperTravel / time.paperDuration)
      assert.ok(time.panelEnd < time.redEnd && time.redEnd < time.paperEnd)
      assert.equal(sampleB(time.redEnd, g).redX, -g.redTravel)
      assert.equal(sampleB(time.total, g).paperX, -viewportWidth)
    }
  }
})
test('paper starts at the exact half-collapse instant while the panel still exists', () => {
  const time = createBTimeline(geometry)
  const at = sampleB(time.paperStart, geometry)
  assert.equal(at.panelProgress, .5)
  assert.equal(at.paperProgress, 0)
  assert.equal(at.panelDone, false)
  assert.ok(sampleB(time.paperStart + 1, geometry).paperProgress > 0)
  assert.ok(sampleB(time.paperStart - 1, geometry).panelProgress < .5)
})
test('panel prepares briefly then collapses and fades without a tail rebound; red and paper never reverse', () => {
  const time = createBTimeline(geometry)
  let previous = sampleB(time.panelPrepare, geometry)
  assert.equal(previous.panelScale, 1.025)
  for (let ms = time.panelPrepare + 1; ms <= time.total + 100; ms++) {
    const frame = sampleB(ms, geometry)
    for (const key of ['panelScale', 'panelOpacity', 'redX', 'paperX']) {
      assert.ok(frame[key] <= previous[key] + 1e-12, `${key} must not reverse at ${ms}`)
    }
    assert.ok(frame.panelScale >= 0 && frame.panelRadius >= 0 && frame.panelRadius <= 50)
    previous = frame
  }
  const insets = panelInsets(1, 360, 420)
  assert.ok(Math.abs(420 * (1 - insets.y * 2 / 100) - 360) < 1e-10, 'final crop is square before scaling')
})
test('six factory groups have distinct spatial origins and finish before paper leaves', () => {
  const total = createBTimeline(geometry).total
  const starts = new Set()
  for (const entry of Object.keys(FACTORY_ENTRANCE)) {
    starts.add(FACTORY_ENTRANCE[entry].start)
    const first = sampleFactoryEntrance(0, entry)
    assert.equal(first.opacity, 0)
    assert.ok(Math.abs(first.x) + Math.abs(first.y) > 0)
    const final = sampleFactoryEntrance(total - 50, entry)
    assert.equal(final.opacity, 1)
    assert.equal(final.x, 0)
    assert.equal(final.y, 0)
    assert.equal(final.done, true)
  }
  assert.equal(starts.size, 6)
})

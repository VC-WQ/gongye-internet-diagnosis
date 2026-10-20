import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022 },
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  )
}
const { sampleA, sampleB } = await load('../src/motion/loginTimeline.ts')
const { DURATION, EASING } = await load('../src/motion/tokens.ts')

const brand = 0.545
const frames = (fn, count = 200) =>
  Array.from({ length: count + 1 }, (_, index) => fn(index / count))

test('motion tokens are a single positive source', () => {
  for (const [key, value] of Object.entries(DURATION)) {
    assert.ok(value > 0, key)
    assert.ok(value < 2, key)
  }
  for (const [key, value] of Object.entries(EASING)) {
    assert.equal(value.length, 4, key)
    value.forEach((item) => assert.ok(item >= 0 && item <= 1, key))
  }
})

test('login A moves directly left, overshoots only near the end and settles', () => {
  const samples = frames((t) => sampleA(t, brand))
  assert.ok(Math.abs(samples[0].rightInset) < 1e-9)
  for (let index = 1; index <= 180; index++) {
    assert.ok(
      samples[index].rightInset >= samples[index - 1].rightInset - 1e-9,
      `A must not reverse at ${index}`,
    )
  }
  const final = sampleA(1, brand)
  const overshoot = sampleA(0.9, brand)
  assert.ok(overshoot.rightInset > final.rightInset)
  assert.ok(Math.abs(final.rightInset - (1 - brand)) < 1e-9)
  assert.ok(samples[0].brandOpacity === 0)
  assert.ok(Math.abs(final.brandOpacity - 1) < 1e-9)
})

test('login B starts red with anticipation, ends without overshoot', () => {
  assert.ok(Math.abs(sampleB(0, brand).redRightInset - (1 - brand)) < 1e-9)
  assert.ok(sampleB(0.12, brand).redRightInset < 1 - brand)
  const near = sampleB(0.99, brand).redRightInset
  const end = sampleB(1, brand).redRightInset
  assert.ok(end === 1)
  assert.ok(near < end)
  const samples = frames((t) => sampleB(t, brand))
  for (let index = 1; index < samples.length; index++) {
    if (index / 200 <= 0.12) continue
    assert.ok(
      samples[index].redRightInset >= samples[index - 1].redRightInset - 1e-9,
      `B red must move left after anticipation at ${index}`,
    )
  }
})

test('login panel prepares upward, collapses to a circle and never rebounds', () => {
  const samples = frames((t) => sampleB(t, brand))
  const prep = sampleB(0.1, brand)
  assert.ok(prep.panelScale > 1)
  assert.ok(prep.panelScale <= 1.0301)
  assert.ok(samples.every((frame) => frame.panelScale >= 0))
  assert.ok(Math.abs(sampleB(1, brand).panelScale) < 1e-9)
  assert.equal(sampleB(1, brand).panelRadius, 50)
  assert.equal(sampleB(1, brand).panelOpacity, 0)
  let seenMax = false
  for (let index = 1; index < samples.length; index++) {
    if (samples[index].panelScale > samples[index - 1].panelScale + 1e-9) {
      assert.ok(!seenMax, 'panel scale must not rebound upward')
    } else if (
      samples[index].panelScale < samples[index - 1].panelScale - 1e-9
    ) {
      seenMax = true
    }
  }
})

test('paper layer stays still until panel collapse reaches half', () => {
  for (const t of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
    const frame = sampleB(t, brand)
    if (frame.panelProgress <= 0.5) assert.ok(Math.abs(frame.paperX) === 0, `t=${t}`)
  }
  const after = sampleB(0.8, brand)
  assert.ok(after.panelProgress > 0.5)
  assert.ok(after.paperX < 0)
  assert.equal(sampleB(1, brand).paperX, -1)
})

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
const { sampleA, sampleB, sampleC, createBTimeline, createCTimeline, panelInsets, sampleFactoryEntrance } = await load('../src/motion/loginTimeline.ts')
const { DURATION, EASING, FACTORY_ENTRANCE } = await load('../src/motion/tokens.ts')
const geometry = { viewportWidth: 1440, redTravel: 1440 * .545 }

test('motion tokens remain positive and easing curves valid', () => {
  for (const [key, value] of Object.entries(DURATION)) assert.ok(value > 0 && value < 2, key)
  for (const [key, values] of Object.entries(EASING)) {
    assert.equal(values.length, 4, key)
    values.forEach((value) => assert.ok(value >= 0 && value <= 1, key))
  }
})
test('A has distinct bounded red, paper and form overshoots and exact landing', () => {
  const frames=Array.from({length:201},(_,i)=>sampleA(i/200))
  assert.equal(frames[0].redX,0);assert.equal(frames[0].panelOpacity,0)
  assert.ok(Math.min(...frames.map(f=>f.redX)) < -1.03)
  assert.ok(Math.min(...frames.map(f=>f.redX)) >= -1.046)
  assert.ok(Math.max(...frames.map(f=>f.paperScale)) > 1.002)
  assert.ok(Math.min(...frames.map(f=>f.panelY)) < -2)
  assert.notEqual(frames.findIndex(f=>f.redX < -1),frames.findIndex(f=>f.panelY < 0))
  const end=sampleA(1);assert.equal(end.redX,-1);assert.equal(end.paperScale,1);assert.equal(end.panelY,0);assert.equal(end.panelScale,1);assert.equal(end.done,true)
  assert.equal('rightInset' in sampleA(.5),false)
})
test('B has three independent clocks and panel, red, paper finish in that order', () => {
  const time = createBTimeline(geometry)
  assert.ok(time.panelEnd < time.redEnd && time.redEnd < time.paperEnd)
  assert.ok(time.panelEnd / time.total < .35)
  assert.ok(time.redEnd / time.total >= .55 && time.redEnd / time.total <= .65)
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
test('red keeps its actual short path with a readable bounded duration across responsive ratios', () => {
  for (const viewportWidth of [320, 390, 768, 1280, 1440, 2560]) {
    for (const ratio of [.2, .4, .545, .7, 1]) {
      const g = { viewportWidth, redTravel: viewportWidth * ratio }
      const time = createBTimeline(g)
      assert.ok(time.redDuration >= 285 && time.redDuration <= 500)
      assert.ok(time.redStart >= 0 && time.redStart < time.redEnd)
      assert.ok(time.panelEnd < time.redEnd && time.redEnd < time.paperEnd)
      assert.equal(sampleB(time.redEnd, g).redX, -g.redTravel)
      assert.equal(sampleB(time.total, g).paperX, -viewportWidth)
    }
  }
})
test('invalid B/C geometry stays finite, bounded and reaches the final state', () => {
  for (const viewportWidth of [0, -10, NaN, Infinity]) {
    for (const redTravel of [0, -100, NaN, Infinity]) {
      const g = { viewportWidth, redTravel }
      for (const value of Object.values(createBTimeline(g))) assert.ok(Number.isFinite(value))
      for (const value of Object.values(createCTimeline(g))) assert.ok(Number.isFinite(value))
      for (const sample of [sampleB(0, g), sampleB(2000, g), sampleC(0, g), sampleC(2000, g)]) {
        for (const value of Object.values(sample)) if (typeof value === 'number') assert.ok(Number.isFinite(value))
      }
      assert.equal(sampleB(2000, g).paperDone, true)
      assert.equal(sampleC(2000, g).done, true)
    }
  }
})
test('C independently restores paper, brand and form in order rather than reversing B', () => {
  const time = createCTimeline(geometry)
  assert.ok(time.paperEnd < time.redEnd && time.redEnd < time.panelEnd)
  assert.ok(time.redStart < time.paperEnd)
  assert.ok(time.panelStart > time.paperEnd && time.panelStart < time.redEnd)
  const first = sampleC(0, geometry)
  assert.equal(first.panelOpacity, 0)
  assert.equal(first.redX, -geometry.redTravel)
  let previous = first
  for (let elapsed = 1; elapsed <= time.total + 50; elapsed++) {
    const frame = sampleC(elapsed, geometry)
    assert.ok(frame.redX >= -geometry.redTravel && frame.redX <= geometry.redTravel * .046)
    assert.equal(frame.paperX,0); assert.ok(frame.paperScale >= 0 && frame.paperScale <= 1.026)
    assert.ok(frame.panelOpacity >= previous.panelOpacity && frame.panelOpacity <= 1)
    assert.ok(frame.panelScale >= .78 && frame.panelScale <= 1.013)
    previous = frame
  }
  assert.equal(previous.done, true)
  assert.equal(previous.panelOpacity, 1)
  assert.equal(previous.panelScale, 1)
  assert.equal(previous.redX, 0)
  assert.equal(previous.paperX, 0); assert.equal(previous.paperScale,1)
  assert.ok(sampleC(80,geometry).paperScale>0);assert.equal(sampleC(80,geometry).redProgress,0)
  assert.ok(Array.from({length:1000},(_,i)=>sampleC(i,geometry)).some(f=>f.redX>0 && f.paperScale===1))
  const middle = sampleC(time.total / 2, geometry)
  const reversed = sampleB(createBTimeline(geometry).total / 2, geometry)
  assert.notEqual(middle.panelOpacity, reversed.panelOpacity)
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
test('B prepares and collapses the form while independent brand/paper have bounded settle', () => {
  const time=createBTimeline(geometry);assert.equal(sampleB(time.panelPrepare,geometry).panelScale,1.025)
  const frames=Array.from({length:time.total+100},(_,i)=>sampleB(i,geometry))
  assert.ok(Math.min(...frames.map(f=>f.redX)) < -geometry.redTravel)
  assert.ok(Math.min(...frames.map(f=>f.paperX)) < -geometry.viewportWidth)
  for(const f of frames){assert.ok(f.panelScale>=0&&f.panelScale<=1.026);assert.ok(f.panelOpacity>=0&&f.panelOpacity<=1);assert.ok(f.panelRadius>=0&&f.panelRadius<=50)}
  const end=frames.at(-1);assert.equal(end.panelScale,0);assert.equal(end.redX,-geometry.redTravel);assert.equal(end.paperX,-geometry.viewportWidth)
  const insets=panelInsets(1,360,420);assert.ok(Math.abs(420*(1-insets.y*2/100)-360)<1e-10)
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
  for(const entry of Object.keys(FACTORY_ENTRANCE)){const spec=FACTORY_ENTRANCE[entry];const peak=sampleFactoryEntrance(spec.start+spec.duration*.72,entry);assert.ok(peak.x*spec.x+peak.y*spec.y<0,entry+' overshoots opposite its origin')}
})

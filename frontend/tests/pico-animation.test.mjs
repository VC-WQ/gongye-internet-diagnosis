import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { PicoController, PICO_EMOTIONS, TALK_SYMBOLS, springTo, blinkAmount, chevronPoints, idleLineY, deformVertex, deformNormal, advancePico, faceVertex } =
  await loadModule('../src/features/pico/animation/controller.ts')

test('spring preserves velocity on retarget and converges independently of ordinary frame rate', () => {
  const a = { value: 0, velocity: 0 }, b = { value: 0, velocity: 0 }
  for (let i = 0; i < 120; i++) springTo(a, 1, 1 / 120)
  for (let i = 0; i < 30; i++) springTo(b, 1, 1 / 30)
  assert.ok(Math.abs(a.value - b.value) < 1e-10)
  const before = { ...a }
  springTo(a, -1, 0)
  assert.ok(Math.abs(a.value - before.value) < 1e-12)
  assert.ok(Math.abs(a.velocity - before.velocity) < 1e-12)
  for (let i = 0; i < 180; i++) springTo(a, -1, 1 / 60)
  assert.ok(Math.abs(a.value + 1) < 1e-8)
})

test('left chevron closes continuously into a horizontal stroke and reopens', () => {
  assert.deepEqual(chevronPoints(0).map((p) => p[1]), [-35, 0, 35])
  assert.ok(chevronPoints(1).every((p) => p[1] === 0))
  assert.ok(chevronPoints(1)[0][0] < chevronPoints(1)[1][0])
  assert.ok(chevronPoints(1)[1][0] < chevronPoints(1)[2][0])
  for (const boundary of [0, 0.12, 0.17, 0.36]) {
    assert.ok(Math.abs(blinkAmount(boundary - 1e-6) - blinkAmount(boundary + 1e-6)) < 0.0001)
  }
  const samples = Array.from({ length: 73 }, (_, i) => blinkAmount(i * 0.005))
  assert.ok(samples.some((value) => value > 0.2 && value < 0.8))
  assert.equal(blinkAmount(0.14), 1)
  assert.equal(blinkAmount(0.36), 0)
  assert.equal(idleLineY(0, 0, false), 148)
  assert.equal(idleLineY(0.5, 0, false), 128)
  assert.equal(idleLineY(1, 0, false), 148)
})

test('curved face vertices lie on the sphere and share body deformation without separating', () => {
  assert.ok(faceVertex(0, 0.5)[2] < faceVertex(0.5, 0.5)[2] - 0.2)
  for (let u = 0; u <= 1; u += 0.1) for (let v = 0; v <= 1; v += 0.1) {
    const face = faceVertex(u, v), body = faceVertex(u, v, 1)
    assert.ok(Math.abs(Math.hypot(...face) - 1.008) < 1e-12)
    const pose = { squash: 0.11, wobble: 0.08 }
    const f = deformVertex(...face, pose), b = deformVertex(...body, pose)
    const gap = Math.hypot(...f.map((value, i) => value - b[i]))
    assert.ok(gap > 0.006 && gap < 0.011)
  }
})

test('rapid interruptions retain pose, normalized expression weights and finite bounded motion', () => {
  const controller = new PicoController(73)
  let frame = controller.step(1 / 60)
  for (let i = 0; i < 2000; i++) {
    if (i % 7 === 0) {
      controller.setEmotion(PICO_EMOTIONS[(i / 7 | 0) % PICO_EMOTIONS.length])
      const sameTime = controller.step(0)
      assert.ok(Math.abs(sameTime.yaw - frame.yaw) < 1e-12)
      assert.ok(Math.abs(sameTime.squash - frame.squash) < 1e-12)
    }
    frame = controller.step(i % 31 === 0 ? 100 : 1 / 60)
    assert.ok(Math.abs(Object.values(frame.weights).reduce((a, b) => a + b, 0) - 1) < 1e-10)
    for (const key of ['yaw', 'pitch', 'roll', 'bob', 'squash', 'wobble']) assert.ok(Number.isFinite(frame[key]) && Math.abs(frame[key]) < 0.5, key)
    assert.ok(Object.values(frame.weights).every((v) => v >= 0 && v <= 1))
  }
})

test('talking is seeded mixed symbols with continuous blend, not a fixed array loop', () => {
  const a = new PicoController(44), b = new PicoController(44)
  const symbols = [], blended = []
  a.setEmotion('talking'); b.setEmotion('talking')
  for (let i = 0; i < 1200; i++) {
    const one = a.step(1 / 60), two = b.step(1 / 60)
    assert.deepEqual(one, two)
    if (symbols.at(-1) !== one.mouthTo) symbols.push(one.mouthTo)
    if (one.mouthMix > 0 && one.mouthMix < 1) blended.push(one.mouthMix)
  }
  assert.ok(new Set(symbols).size >= 7)
  assert.ok(blended.length > 100)
  assert.ok(symbols.every((symbol) => TALK_SYMBOLS.includes(symbol)))
  assert.notDeepEqual(symbols.slice(0, 8), [...TALK_SYMBOLS])
})

test('thinking dots have independent continuous alpha; reduced motion preserves a clear static meaning', () => {
  const controller = new PicoController(84)
  controller.setEmotion('thinking')
  let independent = false
  for (let i = 0; i < 240; i++) {
    const frame = controller.step(1 / 60)
    if (frame.dots.some((value) => value > 0.1 && value < 0.9) && Math.abs(frame.dots[0] - frame.dots[1]) > 0.2) independent = true
  }
  assert.equal(independent, true)
  let frame
  for (let i = 0; i < 240; i++) frame = controller.step(1 / 60, true)
  assert.equal(frame.weights.thinking, 1)
  assert.equal(frame.blink, 0)
  assert.deepEqual(frame.dots, [1, 1, 1])
  assert.ok(Math.abs(frame.yaw) < 1e-8)
  assert.ok(Math.abs(frame.squash) < 1e-8)
})

test('one shared scheduler sleeps when hidden or offscreen and releases listeners after the last avatar', async () => {
  const saved = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame }
  const listeners = new Map(), frames = new Map()
  let id = 0, one = 0, two = 0, visible = true
  globalThis.document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) }
  globalThis.requestAnimationFrame = (fn) => { frames.set(++id, fn); return id }
  globalThis.cancelAnimationFrame = (frame) => frames.delete(frame)
  const tick = () => { const current = [...frames.values()]; frames.clear(); current.forEach((fn) => fn(1)) }
  try {
    const { subscribePicoFrame, wakePicoFrames } = await loadModule('../src/features/pico/animation/scheduler.ts')
    const offOne = subscribePicoFrame({ active: () => visible, render: () => one++ })
    const offTwo = subscribePicoFrame({ active: () => visible, render: () => two++ })
    assert.equal(frames.size, 1)
    tick(); assert.equal(one, 1); assert.equal(two, 1); assert.equal(frames.size, 1)
    visible = false; tick(); assert.equal(frames.size, 0)
    visible = true; wakePicoFrames(); tick(); assert.equal(one, 2)
    document.hidden = true; listeners.get('visibilitychange')(); assert.equal(frames.size, 0)
    document.hidden = false; listeners.get('visibilitychange')(); assert.equal(frames.size, 1)
    offOne(); assert.equal(listeners.size, 1)
    offTwo(); assert.equal(listeners.size, 0); assert.equal(frames.size, 0)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})

test('60-second idle choreography has pauses, all gaze directions and varied bounded micro actions without inventing business emotion', () => {
  const a = new PicoController(97), b = new PicoController(97)
  const kinds = new Set(), changes = []
  let restFrames = 0, previous = 'rest', doubleClosures = 0, wasClosed = false
  let minX = 0, maxX = 0, minY = 0, maxY = 0
  for (let i = 0; i < 60 * 60; i++) {
    const frame = a.step(1 / 60), same = b.step(1 / 60)
    assert.deepEqual(frame, same, 'equal seeds and input must be deterministic')
    assert.equal(frame.weights.idle, 1)
    assert.equal(frame.weights.alert, 0)
    assert.equal(frame.weights.confused, 0)
    kinds.add(frame.action)
    if (frame.action === 'rest') restFrames++
    if (frame.action !== previous) changes.push({ at: frame.time, kind: frame.action })
    previous = frame.action
    if (frame.action === 'double-blink' && frame.blink > .95 && !wasClosed) doubleClosures++
    wasClosed = frame.blink > .95
    minX = Math.min(minX, frame.gazeX); maxX = Math.max(maxX, frame.gazeX)
    minY = Math.min(minY, frame.gazeY); maxY = Math.max(maxY, frame.gazeY)
    for (const key of ['yaw', 'pitch', 'roll', 'bob', 'squash', 'wobble', 'lean']) assert.ok(Number.isFinite(frame[key]) && Math.abs(frame[key]) < .5, key)
    for (const key of ['gazeX', 'gazeY']) assert.ok(Number.isFinite(frame[key]) && Math.abs(frame[key]) < 1, key)
  }
  for (const kind of ['rest', 'look-left', 'look-right', 'look-up', 'look-down', 'tilt', 'nod', 'double-blink', 'lean']) assert.ok(kinds.has(kind), kind)
  assert.ok(restFrames > 60 * 10 && restFrames < 60 * 50, 'real pauses occupy a meaningful but not total proportion')
  assert.ok(minX < -.5 && maxX > .5 && minY < -.4 && maxY > .4)
  assert.ok(doubleClosures >= 2)
  const gaps = changes.filter((row) => row.kind !== 'rest').slice(1).map((row, i) => row.at - changes.filter((x) => x.kind !== 'rest')[i].at)
  assert.ok(new Set(gaps.map((gap) => gap.toFixed(1))).size > 3, 'not an identical-period loop')
})
test('real interaction reactions interrupt from the current pose and settle through the same springs', () => {
  const controller = new PicoController(122)
  let prior = controller.step(1 / 60)
  const gestures = ['attention', 'open', 'close', 'context', 'message', 'answer', 'voice-start', 'voice-pause', 'voice-end', 'notification']
  for (const gesture of gestures) {
    for (let i = 0; i < 27; i++) prior = controller.step(1 / 60)
    controller.react(gesture)
    const instant = controller.step(0)
    assert.equal(instant.action, gesture)
    for (const key of ['yaw', 'pitch', 'roll', 'bob', 'squash', 'wobble', 'gazeX', 'gazeY', 'lean']) assert.ok(Math.abs(instant[key] - prior[key]) < 1e-12, `${gesture}:${key}`)
    assert.equal(instant.weights.idle, 1, 'a body gesture cannot manufacture semantic alerts')
  }
  controller.setEmotion('thinking')
  for (let i = 0; i < 240; i++) prior = controller.step(1 / 60)
  assert.equal(prior.action, 'rest')
  assert.ok(Math.abs(prior.gazeX) < 1e-6 && Math.abs(prior.lean) < 1e-6)
})
test('reduced motion neutralizes autonomous pose and gaze while preserving each actual emotion', () => {
  const controller = new PicoController(52)
  for (let i = 0; i < 180; i++) controller.step(1 / 60)
  for (const emotion of PICO_EMOTIONS) {
    controller.setEmotion(emotion)
    controller.react('notification')
    const frame = controller.step(1 / 60, true)
    assert.equal(frame.weights[emotion], 1)
    assert.equal(frame.action, 'rest')
    assert.equal(frame.blink, 0)
    for (const key of ['yaw', 'pitch', 'roll', 'bob', 'squash', 'wobble', 'gazeX', 'gazeY', 'lean']) assert.ok(Math.abs(frame[key]) < 1e-12, `${emotion}:${key}`)
  }
})
test('incidental hover cannot overwrite deliberate close or speech motion, but user messages can interrupt it', () => {
 const controller=new PicoController(31)
 controller.react('close');controller.step(.1);controller.react('attention')
 assert.equal(controller.step(0).action,'close')
 controller.react('message');assert.equal(controller.step(0).action,'message')
 controller.react('voice-start');controller.step(.1);controller.react('attention')
 assert.equal(controller.step(0).action,'voice-start')
 for(let i=0;i<150;i++)controller.step(1/60)
 controller.react('attention');assert.equal(controller.step(0).action,'attention')
})

test('analytic normals stay perpendicular to deformed surface tangents',()=>{
 for(const pose of [{squash:0,wobble:0},{squash:.12,wobble:.08},{squash:-.08,wobble:-.07}])
 for(let u=.1;u<.9;u+=.13)for(let v=.15;v<.85;v+=.17){
  const p=faceVertex(u,v,1),n=deformNormal(...p,...p,pose),eps=.000001
  for(const [du,dv] of [[eps,0],[0,eps]]){
   const a=deformVertex(...faceVertex(u+du,v+dv,1),pose),b=deformVertex(...faceVertex(u-du,v-dv,1),pose)
   const tangent=a.map((x,i)=>x-b[i]);assert.ok(Math.abs(n.reduce((sum,x,i)=>sum+x*tangent[i],0))/Math.hypot(...tangent)<1e-6)
  }
  assert.ok(Math.abs(Math.hypot(...n)-1)<1e-10)
 }
})
test('low drawing frequency preserves wall-clock choreography through stable substeps',()=>{
 const a=new PicoController(105),b=new PicoController(105);let x,y
 for(let i=0;i<120;i++)x=advancePico(a,.1,false)
 for(let i=0;i<720;i++)y=b.step(1/60)
 assert.ok(Math.abs(x.time-12)<1e-8)
 for(const key of ['time','yaw','gazeX','squash','blink'])assert.ok(Math.abs(x[key]-y[key])<1e-8,key)
})
test('deadline scheduler sleeps and cancels its timer on hide and disposal',async()=>{
 const saved=Object.fromEntries(['document','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]))
 const frames=new Map(),timers=new Map(),listeners=new Map();let id=0,due=0,renders=0,resumes=0
 Object.assign(globalThis,{document:{hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)},requestAnimationFrame:f=>{frames.set(++id,f);return id},cancelAnimationFrame:i=>frames.delete(i),setTimeout:f=>{timers.set(++id,f);return id},clearTimeout:i=>timers.delete(i)})
 const tick=now=>{const work=[...frames.values()];frames.clear();work.forEach(f=>f(now))}
 try{
  const {subscribePicoFrame,wakePicoFrames}=await loadModule('../src/features/pico/animation/scheduler.ts')
  const off=subscribePicoFrame({active:()=>true,due:()=>due,resume:()=>{resumes++},render:now=>{renders++;due=now+100}})
  tick(0);assert.equal(renders,1);assert.equal(frames.size,0);assert.equal(timers.size,1)
  due=0;wakePicoFrames();assert.equal(timers.size,0);assert.equal(frames.size,1);tick(20);assert.equal(renders,2)
  document.hidden=true;listeners.get('visibilitychange')();assert.equal(timers.size,0)
  document.hidden=false;listeners.get('visibilitychange')();listeners.get('visibilitychange')();assert.equal(resumes,1);off();assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(listeners.size,0)
 }finally{Object.assign(globalThis,saved)}
})

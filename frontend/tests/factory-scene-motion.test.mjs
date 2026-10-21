import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source=await readFile(new URL('../src/services/sceneLayout.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2020}})
const scene=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const {MACHINE_BOX,SCENE_GAP,createSlots,assignSlots,sceneView,focusCamera,projectBox,transform,inverse,
  edgeCandidates,outside,boxesOverlap,sweptOverlap,safePath,createRoute,sampleRoute,planScene,sampleItem,settleScene,pointerIntent}=scene
const geometry={matrix:{a:1,b:0,c:0,d:1,e:0,f:0},rect:{left:0,right:900,top:0,bottom:660}}
const item=(id,current,visible=true,present=true)=>({id,current,target:current,velocity:{x:0,y:0},visible,present})
const initial=(count=8,columns=4)=>createSlots(count,columns).map((p,i)=>item(`d${i}`,p))
const close=(a,b)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-6,`${JSON.stringify(a)} != ${JSON.stringify(b)}`)
const checkPlan=(items,plan)=>{
  for(let t=0;t<=plan.duration+30;t+=23){
    const states=items.map(i=>({id:i.id,...sampleItem(i,plan,t)})).filter(s=>s.present)
    for(const s of states) assert.ok(Number.isFinite(s.point.x)&&Number.isFinite(s.point.y))
    for(let i=0;i<states.length;i++) for(let j=0;j<i;j++)
      assert.equal(boxesOverlap(states[i].point,states[j].point,SCENE_GAP-1),false,
        `collision at ${t}: ${states[i].id} / ${states[j].id}; ${plan.diagnostics.join(';')}`)
  }
}
test('real machine envelope and 0/1/2/8/12 seat layouts retain full body clearance',()=>{
  assert.deepEqual(MACHINE_BOX,{left:-103,right:103,top:-77,bottom:151})
  for(const n of [0,1,2,8,12]) for(const columns of [2,3,4]){
    const slots=createSlots(n,columns)
    assert.equal(slots.length,n)
    for(let i=0;i<n;i++) for(let j=0;j<i;j++) assert.equal(boxesOverlap(slots[i],slots[j]),false)
  }
  const slots=createSlots(8)
  for(const p of slots){const b=projectBox(p,geometry.matrix);assert.ok(b.left>=0&&b.right<=900&&b.top>=0&&b.bottom<=660)}
})
test('mobile crops around the existing camera center; all eight seats can be fully focused within camera bounds',()=>{
  const view=sceneView(368,296)
  assert.equal(view.columns,2);assert.equal(view.width,500);assert.equal(view.x+view.width/2,450)
  assert.ok(15*368/view.width>=11,'label text remains readable instead of six pixels')
  const rect={left:view.x,right:view.x+view.width,top:view.y,bottom:view.y+view.height}
  for(const p of createSlots(8,2)){
    const c=focusCamera(p,rect,1.1)
    assert.ok(Math.abs(c.y)<=420&&Math.abs(c.x)<=560&&c.zoom>=.6)
    const b=projectBox(p,{a:c.zoom,b:0,c:0,d:c.zoom,e:450*(1-c.zoom)+c.x,f:330*(1-c.zoom)+c.y})
    assert.ok(b.left>=rect.left&&b.right<=rect.right&&b.top>=rect.top&&b.bottom<=rect.bottom,JSON.stringify({p,c,b,rect}))
  }
})
test('non-unit translated, scaled and skewed CTM exits use client rect and asymmetric full box',()=>{
  const g={matrix:{a:.72,b:.08,c:.05,d:.9,e:173,f:84},rect:{left:200,right:820,top:120,bottom:690}}
  const p={x:240,y:180},inv=inverse(g.matrix)
  close(transform(transform(p,g.matrix),inv),p)
  for(const c of edgeCandidates(p,g)) assert.ok(outside(c.point,g),JSON.stringify(c))
  const left=edgeCandidates(p,g).find(c=>c.edge==='left'),b=projectBox(left.point,g.matrix)
  assert.ok(b.right<g.rect.left)
  const top=edgeCandidates(p,g).find(c=>c.edge==='top')
  assert.ok(projectBox(top.point,g.matrix).bottom<g.rect.top)
})
test('null, singular, NaN and DOM-like prototype matrix never silently mix client/world units',()=>{
  assert.equal(inverse(null),null)
  assert.equal(inverse({a:0,b:0,c:0,d:0,e:0,f:0}),null)
  const proto=Object.create({a:NaN,b:0,c:0,d:1,e:0,f:0})
  assert.equal(inverse(proto),null)
  assert.deepEqual(edgeCandidates({x:0,y:0},null),[])
  assert.ok(planScene(initial(),createSlots(8),null).diagnostics.includes('waiting-geometry'))
})
test('nearest exit candidates prefer the nearest feasible full-body boundary',()=>{
  assert.equal(edgeCandidates({x:70,y:400},geometry)[0].edge,'left')
  assert.equal(edgeCandidates({x:450,y:60},geometry)[0].edge,'top')
  assert.equal(edgeCandidates({x:860,y:400},geometry)[0].edge,'right')
  assert.equal(edgeCandidates({x:450,y:640},geometry)[0].edge,'bottom')
  assert.equal(edgeCandidates({x:450,y:330},geometry,'right')[0].edge,'right')
})
test('stable assignment avoids needless movement and remains deterministic on a reversed catalog',()=>{
  const items=initial(),slots=createSlots(8)
  const a=assignSlots(items,slots),b=assignSlots([...items].reverse(),slots)
  for(const i of items){close(a.get(i.id),i.current);close(b.get(i.id),i.current)}
})
test('full-body and swept collision detects parallel overlap, collinear endpoints and fast pass-through',()=>{
  assert.ok(sweptOverlap({x:0,y:0},{x:600,y:0},{x:300,y:0},{x:300,y:0}))
  assert.ok(boxesOverlap({x:0,y:0},{x:219,y:241}))
  assert.equal(boxesOverlap({x:0,y:0},{x:220,y:0}),false)
  assert.equal(sweptOverlap({x:0,y:0},{x:100,y:0},{x:0,y:300},{x:100,y:300}),false)
})
test('visibility graph makes a short body-safe detour and rejects occupied destination',()=>{
  const obstacle={x:400,y:300},path=safePath({x:100,y:300},{x:750,y:300},[obstacle])
  assert.ok(path.length>2)
  for(let i=1;i<path.length;i++) assert.equal(sweptOverlap(path[i-1],path[i],obstacle,obstacle,SCENE_GAP-1),false)
  assert.equal(safePath({x:0,y:0},obstacle,[obstacle]),null)
})
test('Hermite samples keep the actual interruption point and incoming velocity',()=>{
  const route=createRoute([{x:100,y:100},{x:440,y:150}],{x:110,y:20})
  close(sampleRoute(route,0).point,{x:100,y:100});close(sampleRoute(route,0).velocity,{x:110,y:20})
  const mid=sampleRoute(route,120),again=createRoute([mid.point,{x:100,y:200}],mid.velocity)
  close(sampleRoute(again,0).point,mid.point)
  const final=sampleRoute(route,route.duration+1)
  close(final.point,{x:440,y:150});close(final.velocity,{x:0,y:0});assert.equal(final.done,true)
})
test('eight-device filter runs safely, removes exits, and completes compacted survivors',()=>{
  for(const ids of [[],['d0'],['d1','d6'],['d0','d2','d4','d6'],['d0','d1','d2','d3','d4','d5','d6','d7']]){
    const items=initial().map(i=>({...i,visible:ids.includes(i.id)}))
    const plan=planScene(items,createSlots(ids.length),geometry)
    assert.equal(plan.diagnostics.some(d=>d.includes('retain-safe-position')),false,plan.diagnostics.join(';'))
    checkPlan(items,plan)
    for(const i of items){const s=sampleItem(i,plan,plan.duration+1);assert.equal(s.present,i.visible);if(i.visible)close(s.point,plan.targets.get(i.id))}
  }
})
test('new entries return from remembered edge and have safe temporal reservations',()=>{
  const items=initial().map(i=>({...i,present:i.id==='d1'||i.id==='d6',edge:'left'}))
  const plan=planScene(items,createSlots(8),geometry)
  assert.equal(plan.diagnostics.some(d=>d.includes('retain-safe-position')),false,plan.diagnostics.join(';'))
  checkPlan(items,plan)
  assert.ok(plan.reservations.some(r=>r.kind==='enter'&&r.edge==='left'))
  for(const i of items)assert.equal(sampleItem(i,plan,plan.duration+1).present,true)
})
test('park then move samples preserve the active leg, waiting position, and final identity',()=>{
  const i=item('a',{x:0,y:0}),park=createRoute([i.current,{x:-350,y:0}]),move=createRoute([{x:-350,y:0},{x:350,y:0}])
  const plan={targets:new Map([['a',{x:350,y:0}]]),diagnostics:[],duration:park.duration+100+move.duration,
    reservations:[{id:'a',kind:'park',route:park,start:0,end:park.duration},{id:'a',kind:'move',route:move,start:park.duration+100,end:park.duration+100+move.duration}]}
  assert.equal(sampleItem(i,plan,60).phase,'park')
  const waiting=sampleItem(i,plan,park.duration+50);close(waiting.point,{x:-350,y:0});assert.equal(waiting.phase,'queued')
  close(sampleItem(i,plan,plan.duration+1).point,{x:350,y:0})
})
test('fixed-seed 20 mid-flight reversals keep current coordinates and only latest visibility wins',()=>{
  let state=initial(),seed=9301
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}
  for(let turn=0;turn<20;turn++){
    const items=state.map(i=>({...i,visible:random()>.45}))
    const count=items.filter(i=>i.visible).length,plan=planScene(items,createSlots(count),geometry)
    checkPlan(items,plan)
    const elapsed=Math.min(plan.duration,70+random()*130)
    state=items.map(i=>{const s=sampleItem(i,plan,elapsed);return {...i,current:s.point,velocity:s.velocity,present:s.present,target:plan.targets.get(i.id)??i.target}})
    for(let i=0;i<state.length;i++){
      const same=sampleItem(items[i],plan,0)
      if(items[i].present)close(same.point,items[i].current)
      assert.ok(Number.isFinite(state[i].current.x))
    }
  }
  state=state.map(i=>({...i,visible:true}))
  const final=planScene(state,createSlots(8),geometry)
  checkPlan(state,final)
  assert.equal(final.diagnostics.some(d=>d.includes('retain-safe-position')),false,final.diagnostics.join(';'))
  for(const i of state)assert.equal(sampleItem(i,final,final.duration+1).present,true)
})
test('camera-only corrections reuse assignment; invalid geometry yields a paused plan',()=>{
  const items=initial().map(i=>({...i,visible:i.id==='d0'||i.id==='d6'})),targets=assignSlots(items.filter(i=>i.visible),createSlots(2))
  const moved={matrix:{a:1.7,b:0,c:0,d:1.7,e:-360,f:-170},rect:geometry.rect}
  const plan=planScene(items,createSlots(2),moved,targets)
  assert.deepEqual(plan.targets,targets);checkPlan(items,plan)
  const paused=planScene(items,createSlots(2),{...moved,matrix:{...moved.matrix,a:0,d:0}})
  assert.equal(paused.duration,0);assert.ok(paused.diagnostics.includes('waiting-geometry'))
})
test('fixed-seed filtered subsets across 2/3/4 columns leave no completed exit ghosts',()=>{
  let seed=6141
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}
  for(const columns of [2,3,4]) for(let run=0;run<24;run++){
    const items=initial(8,columns).map(i=>({...i,visible:random()>.5}))
    const count=items.filter(i=>i.visible).length,plan=planScene(items,createSlots(count,columns),geometry)
    checkPlan(items,plan)
    for(const i of items){const s=sampleItem(i,plan,plan.duration+1);assert.equal(s.present,i.visible,`${columns}/${run}: ${plan.diagnostics.join(';')}`)}
    assert.equal(plan.diagnostics.some(d=>d.includes('retain-safe-position')),false,plan.diagnostics.join(';'))
  }
})
test('reduced motion settles final legal seats, removes hidden/deleted visuals and zeroes velocity',()=>{
  const items=initial().map((i,index)=>({...i,visible:index%3===0,velocity:{x:300,y:-50}}))
  // d7 represents a real catalog deletion and is not allowed to keep a business entry.
  items[7].visible=false
  const settled=settleScene(items,createSlots(items.filter(i=>i.visible).length))
  assert.deepEqual(settled.filter(i=>i.present).map(i=>i.id),['d0','d3','d6'])
  for(const i of settled){close(i.velocity,{x:0,y:0});if(i.present)close(i.current,i.target)}
  const visible=settled.filter(i=>i.present)
  for(let i=0;i<visible.length;i++)for(let j=0;j<i;j++)assert.equal(boxesOverlap(visible[i].current,visible[j].current),false)
})
test('an infeasible overlapping input stays finite and exposes a concrete bounded fallback',()=>{
  const items=[item('a',{x:450,y:330}),item('b',{x:450,y:330})]
  const plan=planScene(items,createSlots(2),geometry)
  assert.ok(plan.diagnostics.some(d=>d.endsWith(':retain-safe-position')))
  assert.ok(Number.isFinite(plan.duration))
  for(const i of items){const s=sampleItem(i,plan,plan.duration+1);assert.ok(Number.isFinite(s.point.x)&&Number.isFinite(s.point.y))}
})
test('device and blank pointer sessions distinguish click, drag, pinch and cancel',()=>{
  assert.equal(pointerIntent('a','a',2,false,false,false),'select')
  assert.equal(pointerIntent(undefined,undefined,2,false,false,false),'clear')
  assert.equal(pointerIntent('a','b',0,false,false,false),'none')
  assert.equal(pointerIntent('a','a',5,false,false,false),'gesture')
  assert.equal(pointerIntent('a','a',5,true,false,false),'select')
  assert.equal(pointerIntent(undefined,undefined,0,true,true,false),'gesture')
  assert.equal(pointerIntent(undefined,undefined,0,true,false,true),'gesture')
})

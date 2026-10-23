import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const root=new URL('../src/features/factory/growth/',import.meta.url)
async function compile(name){const source=await readFile(new URL(name+'.ts',root),'utf8');return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText}
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
const motion=data(await compile('growthMotion'))
const focus=data((await compile('focusMotion')).replace(/(['"])\.\/growthMotion\1/g,JSON.stringify(motion)))
const {CameraFocusProgress,VisualGrowthCoordinator}=await import(focus)
const isMoving=(c,t,v)=>['x','y','zoom'].some(k=>Math.abs(t[k]-c[k])>(k==='zoom'?.0004:.08)||Math.abs(v[k])>.02)
const camera=()=>({x:0,y:0,zoom:1}),velocity=()=>({x:0,y:0,zoom:0})

test('original camera spring and selected model settle on the same frame at six refresh rates and multiple distances',()=>{
 for(const hz of [30,60,90,120,144,240])for(const distance of [0,45,200,850]){
  let c=camera(),v=velocity(),t={x:distance,y:-distance*.63,zoom:1.3},now=0
  const clock=new CameraFocusProgress(),visual=new VisualGrowthCoordinator();clock.begin('A',c,t,v,now)
  let cameraEnd,modelEnd,last=0,started=false,firstCamera,firstGrowth
  for(let n=0;n<1500;n++){
   now+=1000/hz;const dt=Math.min(1/hz,.032)
   if(isMoving(c,t,v)){for(const k of ['x','y','zoom']){v[k]+=((t[k]-c[k])*190-v[k]*27)*dt;c[k]+=v[k]*dt}if(!isMoving(c,t,v)){c={...t};v=velocity()}}
   const settled=!isMoving(c,t,v),frame=clock.sample(c,t,v,settled,now)
   assert.ok(frame.progress>=last&&frame.progress<=1);last=frame.progress
   visual.update('A',frame,now,1000/hz)
   const entry=visual.entries.get('A');assert.ok(entry);assert.ok(Number.isFinite(entry.motion.p))
   if(!started){firstCamera=now;started=true}if(entry.motion.p>0&&firstGrowth===undefined)firstGrowth=now
   if(settled&&cameraEnd===undefined)cameraEnd=now
   if(entry.motion.phase==='expanded'&&modelEnd===undefined)modelEnd=now
   if(cameraEnd!==undefined&&modelEnd!==undefined)break
  }
  assert.equal(cameraEnd,modelEnd,`${hz}Hz/${distance}`);assert.ok(Math.abs(firstGrowth-firstCamera)<=1000/hz+1e-6)
 }
})

test('A to B starts B while A remains visible; reversing reuses the same visual instance and position',()=>{
 const visual=new VisualGrowthCoordinator(),frame=(epoch,id,p,settled=false)=>({epoch,deviceId:id,progress:p,settled,startedAt:0})
 visual.update('A',frame(1,'A',0),0,0);visual.update('A',frame(1,'A',1,true),1000,16)
 const original=visual.entries.get('A');assert.equal(original.motion.p,1)
 visual.update('B',frame(2,'B',0),1016,16);visual.update('B',frame(2,'B',.35),1200,16)
 assert.ok(visual.entries.get('B').motion.p>0);assert.ok(original.motion.p>0&&original.motion.p<1)
 const p=original.motion.p
 visual.update('A',frame(3,'A',0),1216,16)
 assert.equal(visual.entries.get('A'),original);assert.equal(original.motion.p,p)
 visual.update('A',frame(3,'A',1,true),2200,16)
 assert.equal(visual.entries.get('A').motion.p,1);assert.equal(visual.entries.size,1)
})

test('latest-only overload is bounded without deleting positive outgoing geometry; final target recovers',()=>{
 const visual=new VisualGrowthCoordinator(4)
 for(let i=0;i<25;i++){
  visual.update('D'+i,{epoch:i+1,deviceId:'D'+i,progress:0,settled:false,startedAt:i*16},i*16,16)
  visual.update('D'+i,{epoch:i+1,deviceId:'D'+i,progress:.1,settled:false,startedAt:i*16},i*16+8,8)
  assert.ok(visual.entries.size<=4)
 }
 const f={epoch:25,deviceId:'D24',progress:1,settled:true,startedAt:384}
 visual.update('D24',f,1500,16);visual.update('D24',f,1516,16)
 assert.equal(visual.entries.size,1);assert.equal(visual.entries.get('D24').motion.p,1)
})

test('cancel, reduced-motion, pause and same-ID resize retain a deterministic terminal state',()=>{
 const visual=new VisualGrowthCoordinator(),f=(epoch,id,p,settled=false)=>({epoch,deviceId:id,progress:p,settled,startedAt:0})
 visual.update('A',f(1,'A',0),0,0);visual.update('A',f(1,'A',.4),300,16)
 const p=visual.entries.get('A').motion.p
 visual.pause(5000);assert.equal(visual.entries.get('A').startAt,5000)
 visual.update('A',f(2,'A',0),5300,0);assert.equal(visual.entries.get('A').motion.p,p)
 visual.update(null,f(3,null,1,true),5500,16,true);assert.equal(visual.entries.size,0)
 visual.update('B',f(4,'B',0),5600,0,true);assert.equal(visual.entries.get('B').motion.p,1)
 visual.reset();assert.equal(visual.entries.size,0)
})

test('clearing after a settled Home view reverses the model instead of cutting off its geometry',()=>{
 const visual=new VisualGrowthCoordinator(),f={epoch:1,deviceId:'A',progress:1,settled:true,startedAt:0}
 visual.update('A',f,0,0)
 const home={epoch:2,deviceId:null,progress:1,settled:true,startedAt:0}
 visual.update('A',home,16,16)
 visual.update(null,home,32,16)
 assert.ok(visual.entries.get('A').motion.p>.99)
 let frames=0
 while(visual.entries.size&&frames++<240)visual.update(null,home,32+frames*16,16)
 assert.equal(visual.entries.size,0);assert.ok(frames>10)
})

test('continuous spring frames under capacity pressure retire small silhouettes and grow the final identity',()=>{
 const visual=new VisualGrowthCoordinator(4),clock=new CameraFocusProgress()
 let c=camera(),v=velocity(),t=camera(),now=0,id='D0',epoch=0,finalPartial=0,maxRetired=0
 for(let n=0;n<700;n++){
  now+=1000/60
  if(n<99&&n%9===0){id='D'+(epoch++%7);t={x:(epoch%2?1:-1)*100*(epoch%4+1),y:35*(epoch%3),zoom:1.3};clock.begin(id,c,t,v,now)}
  const dt=1/60
  if(isMoving(c,t,v)){for(const k of ['x','y','zoom']){v[k]+=((t[k]-c[k])*190-v[k]*27)*dt;c[k]+=v[k]*dt}if(!isMoving(c,t,v)){c={...t};v=velocity()}}
  const previous=new Map([...visual.entries].map(([key,e])=>[key,e.motion.p]))
  visual.update(id,clock.sample(c,t,v,!isMoving(c,t,v),now),now,1000/60)
  assert.ok(visual.entries.size<=4)
  for(const [key,p] of previous)if(!visual.entries.has(key))maxRetired=Math.max(maxRetired,p)
  const current=visual.entries.get(id)
  if(n>=99&&current&&current.motion.p>0&&current.motion.p<1)finalPartial++
 }
 assert.ok(maxRetired<.02,`visible retirement seam ${maxRetired}`)
 assert.ok(finalPartial>=2,`final target must visibly grow: ${finalPartial}`)
 assert.equal(visual.entries.size,1);assert.equal(visual.entries.get(id).motion.p,1)
})

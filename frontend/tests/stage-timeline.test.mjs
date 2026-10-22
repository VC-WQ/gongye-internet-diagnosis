import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2020}}).outputText
const uri=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`
const read=p=>readFile(new URL(p,import.meta.url),'utf8')
const catalog=uri(compile(await read('../src/features/about/research.ts')))
const nav=uri(compile(await read('../src/features/about/researchNavigation.ts')).replace("'./research'",JSON.stringify(catalog)))
const {RESEARCH_SCENES,stageFrame,sceneIndex,timelinePosition}=await import(uri(compile(await read('../src/features/about/stageTimeline.ts')).replace("'./research'",JSON.stringify(catalog)).replace("'./researchNavigation'",JSON.stringify(nav))))
const contract=uri(compile(await read('../src/features/about/dataContract.ts')))
const {stageEvidence}=await import(uri(compile(await read('../src/features/about/stageEvidence.ts')).replace("'./dataContract'",JSON.stringify(contract))))
test('all 19 route protocol identities map to one timeline without losing legacy points',()=>{
 assert.equal(RESEARCH_SCENES.length,19);assert.equal(RESEARCH_SCENES.filter(s=>s.point).length,13)
 assert.equal(new Set(RESEARCH_SCENES.map(s=>s.id)).size,19)
 RESEARCH_SCENES.forEach((s,i)=>assert.equal(sceneIndex(s.id),i))
 assert.equal(sceneIndex('arbitrary'),0)
})
test('hold occupies majority; handoff overlaps two spatial layers and reverses deterministically',()=>{
 assert.equal(stageFrame(3.57).mix,0)
 const middle=stageFrame(3.79);assert.ok(Math.abs(middle.mix-.5)<1e-8)
 assert.equal(middle.base,3);assert.equal(middle.next,4)
 const samples=[3,3.7,3.9,4,3.9,3.7,3].map(p=>stageFrame(p))
 assert.equal(samples[1].mix,samples[5].mix);assert.equal(samples[2].mix,samples[4].mix)
 assert.equal(samples[3].base,4);assert.equal(samples[3].mix,0)
})
test('out of range scroll, final hold and invalid values stay inside catalogue',()=>{
 for(const p of [-Infinity,NaN,-100,0,18,30,Infinity]){const f=stageFrame(p);assert.ok(f.active>=0&&f.active<19);assert.ok(f.mix>=0&&f.mix<=1)}
 assert.equal(stageFrame(18).next,18);assert.equal(stageFrame(18).mix,0)
 assert.equal(timelinePosition(200,100,100),18)
 assert.equal(timelinePosition(-100,100,100),0)
 assert.equal(timelinePosition(150,100,100),9)
 assert.equal(timelinePosition(4999.7,100,11025),8)
})
test('known units and actual zeros remain intact; missing data is not replaced',()=>{
 const e={'cwru-signal':{status:'available',data:{overview:{fs:12000},time_domain:{waves:[{name:'normal',t_ms:[0,1],wave:[0,.2]}]}}}}
 const p=stageEvidence('cwru-signal',e);assert.equal(p.y,'振幅（g）');assert.deepEqual(p.series[0].data,[[0,0],[1,.2]])
 assert.equal(stageEvidence('cwru-signal',{}),undefined)
 assert.equal(stageEvidence('cwru-signal',{'cwru-signal':{status:'incomplete',data:e['cwru-signal'].data}}),undefined)
})
test('negative R² is preserved and null/non-finite values do not become fabricated zeroes',()=>{
 const p=stageEvidence('steam',{'steam-analysis':{status:'available',data:{}},steam:{status:'available',data:{methods:[{name:'a',r2:-1.1966},{name:'b',r2:0},{name:'missing',r2:null},{name:'bad',r2:NaN}]}}})
 assert.deepEqual(p.series[0].data,[['a',-1.1966],['b',0]])
})
test('runtime counts never masquerade as accuracy and simulation time keeps hours',()=>{
 assert.equal(stageEvidence('self-evolution-loop',{'self-evolution-loop':{status:'available',data:{metrics:{accuracy:0}}}}),undefined)
 const p=stageEvidence('digital-twin-phm',{'digital-twin-phm':{status:'available',data:{degradation:{series:[{t:0,prob:0}]}}}})
 assert.equal(p.x,'运行时间（小时）');assert.deepEqual(p.series[0].data,[[0,0]])
})

const timelineUri=uri(compile(await read('../src/features/about/stageTimeline.ts')).replace("'./research'",JSON.stringify(catalog)).replace("'./researchNavigation'",JSON.stringify(nav)))
const {stageBoundaryKey}=await import(uri(compile(await read('../src/features/about/stageVisual.ts')).replace("'./stageTimeline'",JSON.stringify(timelineUri))))
test('continuous positions use only mount/accessibility boundaries for React state',()=>{
 const positions=Array.from({length:1801},(_,i)=>i/100)
 const keys=positions.map(p=>stageBoundaryKey(p,false));assert.ok(new Set(keys).size<=56)
 assert.equal(stageBoundaryKey(.1,false),stageBoundaryKey(.57,false))
 assert.notEqual(stageBoundaryKey(.57,false),stageBoundaryKey(.6,false))
 assert.notEqual(stageBoundaryKey(.6,false),stageBoundaryKey(.9,false))
 assert.equal(stageBoundaryKey(.8,true),stageBoundaryKey(.99,true))
 assert.deepEqual(positions.map(p=>stageBoundaryKey(p,false)).reverse(),positions.reverse().map(p=>stageBoundaryKey(p,false)))
})

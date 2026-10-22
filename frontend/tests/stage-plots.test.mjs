import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const uri=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2020}}).outputText
const contract=uri(compile(await readFile(new URL('../src/features/about/dataContract.ts',import.meta.url),'utf8')))
const {sharedLife,signalStage,domainStage,twinStage}=await import(uri(compile(await readFile(new URL('../src/features/about/stagePlots.ts',import.meta.url),'utf8')).replace("'./dataContract'",JSON.stringify(contract))))
test('life bridge requires identical bearing, count and actual RUL; null forecast breaks path',()=>{
 const x={bearings:[{id:'B',series:[{t:0,rul:1,hi:0},{t:1,rul:.5,hi:.3},{t:2,rul:0,hi:1}]}]}
 const r={curves:[{id:'B',actual:[1,.5,0],sde_pf:[1,null,0],baseline:[null,.7,.1]}]}
 const g=sharedLife(x,r);assert.equal(g.end,2);assert.equal(g.count,3);assert.equal((g.forecast.match(/M/g)||[]).length,2)
 assert.equal(sharedLife(x,{curves:[{...r.curves[0],id:'OTHER'}]}),undefined)
 assert.equal(sharedLife(x,{curves:[{...r.curves[0],actual:[1,.4,0]}]}),undefined)
 assert.equal(sharedLife(x,{curves:[{...r.curves[0],actual:[1,0]}]}),undefined)
 assert.equal(sharedLife(undefined,r),undefined)
})
test('signal carries measured wave, FFT and embeddings; domain plot invents no embeddings',()=>{
 const d={time_domain:{waves:[{label:'normal',t_ms:[0,1],wave:[0,.2]}]},frequency_domain:{spectra:[{label:'normal',freqs:[0,10],amp:[0,.5]}]},tsne:{class_names:['Normal'],points:[[1,2],[3,4]],labels:['Normal','IR']}}
 const o=signalStage(d);assert.equal(o.grid.length,3);assert.deepEqual(o.series[2].data,[[1,2]]);assert.deepEqual(o.series[0].data,[[0,0],[1,.2]])
 const a=domainStage({target_domains:{motor:{name:'motor'}},results:[{id:'V0',per_device:{motor:{accuracy:0}},source_test_accuracy:null,target_macro_accuracy:0}]})
 assert.deepEqual(a.series[0].data,[[0,0,0]]);assert.deepEqual(a.series[1].data,[null]);assert.equal(a.series.some(s=>s.type==='scatter'),false)
})
test('twin hours, event coordinates, observations and zero risk remain exact',()=>{
 const o=twinStage({degradation:{series:[{t:0,hazard:0,prob:0,vib_n:.2}],events:{crit_at:3,maint_at:null,fail_at:8}},ttf_prediction:{points:[[1,2],[0,0]]}})
 assert.deepEqual(o.series[0].data,[[0,0]]);assert.deepEqual(o.series[0].markLine.data.map(x=>x.xAxis),[3,8]);assert.deepEqual(o.series[3].data,[[1,2],[0,0]])
})
test('mismatched prediction lengths cannot enter shared geometry',()=>{
 const x={bearings:[{id:'B',series:[{t:0,rul:1,hi:0},{t:1,rul:0,hi:1}]}]}
 assert.equal(sharedLife(x,{curves:[{id:'B',actual:[1,0],sde_pf:[1,0,2],baseline:[1,0]}]}),undefined)
})
test('compact options release secondary grids while keeping real primary series',()=>{
 const d={time_domain:{waves:[{label:'N',t_ms:[0],wave:[0]}]},frequency_domain:{spectra:[{label:'N',freqs:[0],amp:[0]}]},tsne:{class_names:['N'],points:[[0,0]],labels:['N']}}
 const o=signalStage(d,true);assert.equal(o.grid.length,2);assert.equal(o.series.length,2);assert.equal(o.series.some(s=>s.xAxisIndex===2),false)
 const a=domainStage({target_domains:{motor:{name:'motor'}},results:[{id:'V0',per_device:{motor:{accuracy:0}},source_test_accuracy:null,target_macro_accuracy:0}]},true)
 assert.equal(a.series.length,1);assert.equal(a.grid.length,1);assert.deepEqual(a.series[0].data,[[0,0,0]])
})

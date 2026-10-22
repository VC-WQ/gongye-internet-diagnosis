import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2020}}).outputText
const uri=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const source=path=>readFile(new URL(path,import.meta.url),'utf8')
const catalogUri=uri(compile(await source('../src/features/about/research.ts')))
const {RESEARCH_TOPICS}=await import(catalogUri)
const navigation=compile(await source('../src/features/about/researchNavigation.ts')).replace("'./research'",JSON.stringify(catalogUri))
const {researchTarget,RESEARCH_ANCHORS,activeResearchHeading,ResearchScrollIntent,estimateFigureHeight}=await import(uri(navigation))
const {researchSources,ResearchRequestCache,figureSources,sceneSources}=await import(uri(compile(await source('../src/features/about/researchRequests.ts'))))
test('all five topics and thirteen legacy points map to unique article anchors',()=>{
 assert.equal(RESEARCH_TOPICS.length,5);assert.equal(RESEARCH_TOPICS.flatMap(t=>t.points).length,13)
 assert.equal(RESEARCH_ANCHORS.length,19);assert.equal(new Set(RESEARCH_ANCHORS).size,19)
 for(const t of RESEARCH_TOPICS)for(const p of t.points)assert.equal(researchTarget('',t.id,p.id),`research-${t.id}-${p.id}`)
 assert.equal(researchTarget('#research-health-rul','results','vision'),'research-health-rul')
 assert.equal(researchTarget('#%E0%A4%A','invalid','invalid'),'research-overview')
 assert.equal(researchTarget('#arbitrary-id','health','missing'),'research-health')
})
test('manual heading state follows ordered geometry and preserves the final chapter at page end',()=>{
 const headings=[{id:'research-overview',top:-400},{id:'research-signal',top:60},{id:'research-signal-assets',top:360}]
 assert.equal(activeResearchHeading(headings,88),'research-signal')
 assert.equal(activeResearchHeading(headings.map(h=>({...h,top:h.top-400})),88),'research-signal-assets')
 assert.equal(activeResearchHeading(headings,88,true),'research-signal-assets')
})
test('user interruption invalidates late scroll completions; a new click gets its own ownership',()=>{
 const intent=new ResearchScrollIntent();const old=intent.begin();assert.ok(intent.current(old));intent.cancel();assert.ok(!intent.current(old))
 const next=intent.begin();assert.ok(intent.current(next));assert.ok(!intent.current(old));intent.cancel();assert.ok(!intent.current(next))
})
test('placeholder estimates represent full renderers and responsive layouts, not one generic chart',()=>{
 const figures=RESEARCH_TOPICS.flatMap(t=>t.points.flatMap(p=>p.figure?[p.figure]:[]))
 assert.equal(new Set(figures).size,12)
 for(const f of figures){assert.ok(estimateFigureHeight(f,false)>200);assert.ok(estimateFigureHeight(f,true)>200)}
 assert.notEqual(estimateFigureHeight('vision',false),estimateFigureHeight('steam',false))
 assert.ok(estimateFigureHeight('cwru-signal',true)>estimateFigureHeight('cwru-signal',false))
})
test('public article excludes operational loop transport, authenticated article includes it',()=>{
 assert.equal(researchSources(false).length,12);assert.equal(researchSources(true).length,13)
 assert.ok(!researchSources(false).includes('self-evolution-loop'))
 assert.ok(researchSources(true).includes('self-evolution-loop'))
})
test('StrictMode consumers and lazy figures share one pending source request',async()=>{
 const cache=new ResearchRequestCache();let calls=0;let resolve
 const loader=()=>{calls++;return new Promise(r=>resolve=r)}
 const a=cache.read('classification',loader),b=cache.read('classification',loader);assert.equal(a,b)
 await Promise.resolve();assert.equal(calls,1);resolve({status:'available',data:{score:0}})
 assert.deepEqual(await a,{status:'available',data:{score:0}});assert.equal(await b,await a)
 cache.clear();await cache.read('classification',async()=>{calls++;return {status:'missing'}});assert.equal(calls,2)
})
test('separate public and account scopes never reuse cached payloads',async()=>{
 const first=new ResearchRequestCache(),second=new ResearchRequestCache()
 const a=await first.read('self-evolution-loop',async()=>({status:'available',data:{account:'A'}}))
 const b=await second.read('self-evolution-loop',async()=>({status:'missing'}))
 assert.equal(a.status,'available');assert.equal(b.status,'missing');assert.equal(b.data,undefined)
})

test('scene requests separate overview from CWRU and keep steam correlation dependency',()=>{
 assert.deepEqual(sceneSources({}),['dataset-registry'])
 assert.deepEqual(sceneSources({topic:{id:'signal'},point:{figure:'cwru-signal'}}),['cwru-signal'])
 assert.deepEqual(figureSources('steam'),['steam','steam-analysis'])
 assert.deepEqual(figureSources('rul-sde-pf'),['xjtu-rul','rul-sde-pf'])
 assert.deepEqual(figureSources('xjtu-rul'),['xjtu-rul','rul-sde-pf'])
 assert.deepEqual(sceneSources({topic:{id:'health'}}),[])
 assert.equal(researchSources(false).includes('self-evolution-loop'),false)
})

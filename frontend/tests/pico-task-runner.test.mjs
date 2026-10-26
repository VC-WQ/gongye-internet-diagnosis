import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source=await readFile(new URL('../src/features/pico/core/taskRunner.ts',import.meta.url),'utf8')
const {runPicoTask}=await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`)
const response=(step,status,extra={})=>({task_id:'task-1',step,status,tool_calls:step,text:'',trace:[],references:[],context_revision:step===3?2:1,meta:{},...extra})
const page=revision=>({context:{route:'/dashboard',area:'factory',context_revision:revision},page_snapshot:{state:'ready'}})

test('task observes each real UI result and reads the new page before replanning',async()=>{
  let revision=1;const calls=[]
  const result=await runPicoTask('task-1',{
    start:async()=>{calls.push('start');return response(1,'running')},
    resume:async(previous,current,observation)=>{calls.push(['continue',previous.step,current.context.context_revision,observation?.status]);return previous.step===1?response(2,'awaiting_ui',{ui_action:{type:'set_factory_filter',action_id:'action-1',status:'degraded'}}):response(3,'completed')},
    readPage:()=>{calls.push('read');return page(revision)},valid:()=>true,
    execute:async()=>{calls.push('execute');revision=2;return {action_id:'action-1',status:'succeeded',message:'已验证'}},update:()=>{},
  },new AbortController().signal)
  assert.equal(result.status,'completed')
  assert.deepEqual(calls.filter(Array.isArray),[['continue',1,1,undefined],['continue',2,2,'succeeded']])
  assert.equal(calls.filter(x=>x==='execute').length,1)
})

test('unconfigured planner terminates without executing a UI or inventing completion',async()=>{
  let executed=0
  const result=await runPicoTask('task-1',{start:async()=>response(0,'unverified'),resume:async()=>assert.fail(),readPage:()=>page(1),valid:()=>true,execute:async()=>{executed++;assert.fail()},update:()=>{}},new AbortController().signal)
  assert.equal(result.status,'unverified');assert.equal(executed,0)
})

test('late response cannot execute after cancellation or external context change',async()=>{
  for(const mode of ['abort','context']){
    const controller=new AbortController();let valid=true,executed=0
    await assert.rejects(runPicoTask('task-1',{start:async()=>{if(mode==='abort')controller.abort();else valid=false;return response(1,'awaiting_ui',{ui_action:{type:'set_theme',action_id:'a',theme:'dark'}})},resume:async()=>assert.fail(),readPage:()=>page(1),valid:()=>valid,execute:async()=>{executed++;assert.fail()},update:()=>{}},controller.signal),{name:'AbortError'})
    assert.equal(executed,0)
  }
})

test('failed UI observation is returned accurately and does not auto-run a later action',async()=>{
  let executed=0,observed
  const result=await runPicoTask('task-1',{start:async()=>response(1,'awaiting_ui',{ui_action:{type:'set_theme',action_id:'a',theme:'dark'}}),resume:async(_,__,observation)=>{observed=observation;return response(2,'failed')},readPage:()=>page(1),valid:()=>true,execute:async()=>{executed++;return{action_id:'a',status:'failed',message:'主题未提交'}},update:()=>{}},new AbortController().signal)
  assert.equal(result.status,'failed');assert.equal(observed.status,'failed');assert.equal(executed,1)
})

test('wrong identity, stale revision, repeat step and over-budget responses stop the loop',async()=>{
  for(const bad of [{task_id:'foreign'},{context_revision:99},{step:9},{tool_calls:13}]) await assert.rejects(runPicoTask('task-1',{start:async()=>response(1,'running',bad),resume:async()=>assert.fail(),readPage:()=>page(1),valid:()=>true,execute:async()=>assert.fail(),update:()=>{}},new AbortController().signal),/契约/)
  await assert.rejects(runPicoTask('task-1',{start:async()=>response(1,'running'),resume:async()=>response(1,'running'),readPage:()=>page(1),valid:()=>true,execute:async()=>assert.fail(),update:()=>{}},new AbortController().signal),/没有取得/)
})

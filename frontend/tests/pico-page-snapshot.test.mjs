import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const code = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`
const research = code(await read('../src/features/about/research.ts'))
const workspace = code(await read('../src/services/workspaceMode.ts'))
const { describePicoPage, registerPicoPageAdapter, buildPicoPageSnapshot } = await import(code((await read('../src/features/pico/core/pageSnapshot.ts')).replace("'../../about/research'", JSON.stringify(research)).replace("'../../../services/workspaceMode'", JSON.stringify(workspace))))
const context = { route: '/dashboard', area: 'factory', context_revision: 2 }

test('page registry covers real routes and rejects invented tools and research identities', () => {
  for (const path of ['/dashboard', '/manage/devices', '/manage/devices/pump-001', '/manage/records', '/manage/records/1', '/tools', '/research', '/research/health/rul', '/admin/users', '/admin/devices', '/admin/records', ...['diagnosis','events','simulation','vision','pico','evaluation','settings'].map(x=>`/tools/${x}`)]) assert.notEqual(describePicoPage(path).id, 'unknown', path)
  for (const path of ['/tools/terminal', '/research/made-up', '/research/health/made-up', '/admin/config', '/login']) assert.equal(describePicoPage(path).id, 'unknown', path)
})

test('snapshot reads the live adapter and only approved query filters, never secret parameters', () => {
  const release = registerPicoPageAdapter(() => ({ route:'/dashboard', search:'?q=泵&status=degraded&token=secret&password=secret', state:'ready', entities:[{kind:'device',id:'pump-002',name:'泵 B',selected:false}],visible_data:[{label:'目录评分',value:68,source:'/api/v1/devices'}] }))
  const snapshot = buildPicoPageSnapshot(context, '?q=泵&status=degraded&token=secret&password=secret', null)
  assert.deepEqual(snapshot.filters, {status:'degraded',q:'泵'})
  assert.equal(snapshot.entities[0].id,'pump-002')
  assert.equal(snapshot.state,'ready')
  assert.ok(!JSON.stringify(snapshot).includes('secret'))
  assert.equal(buildPicoPageSnapshot(context, 'q=泵&status=degraded&token=secret&password=secret', null).entities[0].id,'pump-002')
  release()
})

test('stale page adapter and stale cleanup cannot pollute another route or its successor', () => {
  const old = registerPicoPageAdapter(() => ({ route:'/dashboard',search:'',state:'ready',entities:[{kind:'device',id:'old',name:'old',selected:false}] }))
  const current = registerPicoPageAdapter(() => ({ route:'/manage/records',search:'',state:'empty',entities:[] }))
  old()
  assert.equal(buildPicoPageSnapshot({...context,route:'/manage/records'},'',null).state,'empty')
  assert.deepEqual(buildPicoPageSnapshot(context,'',null).entities,[])
  current()
})

test('large snapshot stays bounded, preserves true context identity and sanitizes nonfinite values', () => {
  const release=registerPicoPageAdapter(()=>({route:'/dashboard',search:'',state:'ready',entities:Array.from({length:100},(_,i)=>({kind:'device',id:`pump-${i}`,name:'长'.repeat(500),selected:false})),visible_data:Array.from({length:100},(_,i)=>({label:'数据'.repeat(100),value:i? '值'.repeat(1000):NaN,source:'/api/v1/devices'}))}))
  const snapshot=buildPicoPageSnapshot({...context,device_id:'pump-1'},'',null)
  assert.equal(snapshot.version,1);assert.equal(snapshot.selection.device_id,'pump-1');assert.ok(JSON.stringify(snapshot).length<=15000)
  assert.ok(snapshot.entities.length<=20);assert.ok(snapshot.visible_data.length<=40);assert.equal(snapshot.visible_data[0].value,null)
  release()
})

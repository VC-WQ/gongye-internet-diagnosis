import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const load=async path=>{const source=await readFile(new URL(path,import.meta.url),'utf8');const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}});return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)}
const {changeFlip,finishFlip}=await load('../src/motion/flipState.ts')
const {reconcileRows}=await load('../src/motion/presenceState.ts')
test('rapid A to B to A folds actual committed text and ignores old completion',()=>{
 let state={current:'A',revision:0};state=changeFlip(state,'B');const oldRevision=state.revision;state=changeFlip(state,'A');
 assert.equal(state.current,'A');assert.equal(state.previous,'B');assert.equal(finishFlip(state,oldRevision),state);assert.equal(finishFlip(state,state.revision).previous,undefined)
})
test('unchanged values do not replay and reduced motion goes directly to actual value',()=>{
 const state={current:'0',revision:0};assert.equal(changeFlip(state,'0'),state);assert.deepEqual(changeFlip(state,'-0.42',true),{current:'-0.42',previous:undefined,revision:1})
})
test('presence retains stable IDs, removes stale payload, and re-entry cancels exit without duplicates',()=>{
 const id=x=>String(x.id);let rows=reconcileRows([],[{id:1,value:'old'},{id:2}],id);
 rows=reconcileRows(rows,[{id:1,value:'new'},{id:3}],id);assert.equal(rows.find(r=>r.id==='1').item.value,'new');assert.equal(rows.find(r=>r.id==='2').exiting,true);
 rows=reconcileRows(rows,[{id:2,value:'returned'},{id:3}],id);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);assert.equal(rows.find(r=>r.id==='2').exiting,false);assert.equal(rows.find(r=>r.id==='2').item.value,'returned')
})

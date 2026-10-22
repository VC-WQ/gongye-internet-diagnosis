import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const {outputText}=ts.transpileModule(await readFile(new URL('../src/motion/textHandoff.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022}})
const {textHandoff}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
test('before pending B reaches the window, A remains the outgoing screen for C',()=>{
 const p=textHandoff([{text:'A',y:0,height:24},{text:'B',y:24,height:24}],24)
 assert.deepEqual(p.visible.map(x=>x.text),['A']);assert.equal(p.distance,24)
})
test('mid-flight keeps both visible rows; rapid 40ms replacements never lose the window',()=>{
 let rows=[{text:'A',y:0,height:24}]
 for(let i=0;i<25;i++){
  const p=textHandoff(rows,24);assert.ok(p.visible.length>0)
  rows=[...p.visible,{text:String(i),y:p.distance,height:24}].map(x=>({...x,y:x.y-p.distance*.15}))
  assert.ok(rows.some(x=>x.y<24&&x.y+x.height>0))
  assert.ok(rows.length<=3)
 }
})
test('wrapped rows retain their actual extent rather than the incoming short height',()=>{
 const p=textHandoff([{text:'long',y:-10,height:48},{text:'pending',y:48,height:24}],48)
 assert.equal(p.distance,48);assert.equal(p.visible[0].height,48);assert.equal(p.visible.length,1)
})

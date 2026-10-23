import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source=await readFile(new URL('../src/services/time.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022}})
const {formatTime}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
test('backend UTC timestamps without suffix display the same instant as explicit UTC',()=>{
 assert.equal(formatTime('2026-10-19T15:12:48'),formatTime('2026-10-19T15:12:48Z'))
 assert.equal(formatTime('2026-10-19T15:12:48'),formatTime('2026-10-19T23:12:48+08:00'))
})
test('seconds, milliseconds, invalid and missing event timestamps remain honest',()=>{
 assert.equal(formatTime(1792422768),formatTime(1792422768000))
 assert.equal(formatTime(null),'—');assert.equal(formatTime('invalid'),'—')
})

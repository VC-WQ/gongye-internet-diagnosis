import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const moduleAt = async(path) => {
 const source=await readFile(new URL(path,import.meta.url),'utf8')
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022}})
 return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const {NotificationGate}=await moduleAt('../src/features/pico/core/notificationGate.ts')
test('Pico only notifies sourced significant events, deduplicates and rate limits',()=>{
 const gate=new NotificationGate(), message={eventId:1,deviceId:'A',text:'真实业务结果',severity:'critical'}
 assert.equal(gate.accept({...message,severity:'info'},0),false)
 assert.equal(gate.accept({...message,eventId:undefined},0),false)
 assert.equal(gate.accept(message,0),true)
 assert.equal(gate.accept(message,10000),false)
 assert.equal(gate.accept({...message,eventId:2},1000),false)
 assert.equal(gate.accept({...message,eventId:2},4000),true)
 assert.equal(gate.accept(message,300001),true)
})
const queue=[]
globalThis.window={speechSynthesis:{getVoices:()=>[],addEventListener:()=>{},speak:u=>queue.push(u),cancel:()=>{}}}
globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text}}
const {speakChinese,stopChineseSpeech}=await moduleAt('../src/services/speech.ts')
test('speech animation follows actual start, pause, resume and completion, not queuing',()=>{
 const states=[];let ended=0
 assert.equal(speakChinese('测试',()=>ended++,state=>states.push(state)),true)
 assert.deepEqual(states,[])
 const u=queue.at(-1);u.onstart();u.onpause();u.onresume();u.onend()
 assert.deepEqual(states,['start','pause','resume','end']);assert.equal(ended,1)
})
test('cancel and error complete exactly once and late native events cannot restart animation',()=>{
 const states=[]
 speakChinese('A',undefined,state=>states.push(state));const old=queue.at(-1)
 old.onstart();stopChineseSpeech();old.onend();old.onstart()
 assert.deepEqual(states,['start','cancel'])
 speakChinese('B',undefined,state=>states.push(state));queue.at(-1).onerror();queue.at(-1).onend()
 assert.deepEqual(states,['start','cancel','error'])
})
test('replacing speech cancels the prior utterance before the next one starts',()=>{
 const states=[]
 speakChinese('A',undefined,state=>states.push('A:'+state));const old=queue.at(-1)
 speakChinese('B',undefined,state=>states.push('B:'+state));old.onstart();queue.at(-1).onstart();queue.at(-1).onend()
 assert.deepEqual(states,['A:cancel','B:start','B:end'])
})

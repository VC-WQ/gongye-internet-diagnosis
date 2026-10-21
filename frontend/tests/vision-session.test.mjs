import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source=await readFile(new URL('../src/services/visionSession.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2020}})
const {VisionSession}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}

test('late A detection cannot populate a result after the user replaces it with file B',async()=>{
  const session=new VisionSession(),response=deferred()
  session.replaceFile()
  const a=session.begin()
  let shown
  const work=response.promise.then(value=>{if(session.accepts(a))shown=value})
  session.replaceFile()
  response.resolve({image:'A',model:'yolov8s'})
  await work
  assert.equal(shown,undefined)
  const b=session.begin()
  assert.equal(session.accepts(b),true)
})

test('old request finally never clears the current B loading state or replaces its result',async()=>{
  const session=new VisionSession(),a=deferred(),b=deferred()
  session.replaceFile()
  const first=session.begin()
  let loading=true,shown
  const firstWork=a.promise.then(value=>{if(session.accepts(first))shown=value})
    .finally(()=>{if(session.accepts(first))loading=false})
  session.replaceFile()
  const second=session.begin()
  const secondWork=b.promise.then(value=>{if(session.accepts(second))shown=value})
    .finally(()=>{if(session.accepts(second))loading=false})
  a.resolve('A')
  await firstWork
  assert.equal(loading,true);assert.equal(shown,undefined)
  b.resolve('B')
  await secondWork
  assert.equal(loading,false);assert.equal(shown,'B')
})

test('changing model invalidates detection but permits the same file preview to finish',()=>{
  const session=new VisionSession(),fileRevision=session.replaceFile(),old=session.begin()
  session.replaceModel()
  assert.equal(session.accepts(old),false)
  assert.equal(session.acceptsFile(fileRevision),true)
  const next=session.begin()
  assert.equal(next.input,session.revision);assert.equal(session.accepts(next),true)
})

test('replaced file readers cannot overwrite a newer preview even if callbacks arrive out of order',async()=>{
  const session=new VisionSession(),a=deferred(),b=deferred()
  const first=session.replaceFile()
  let preview
  const firstRead=a.promise.then(value=>{if(session.acceptsFile(first))preview=value})
  const second=session.replaceFile()
  const secondRead=b.promise.then(value=>{if(session.acceptsFile(second))preview=value})
  b.resolve('preview-B');await secondRead
  a.resolve('preview-A');await firstRead
  assert.equal(preview,'preview-B')
})

test('same-input retries commit only the newest request and result revision still matches input',()=>{
  const session=new VisionSession()
  session.replaceFile()
  const old=session.begin(),latest=session.begin()
  assert.equal(session.accepts(old),false);assert.equal(session.accepts(latest),true)
  assert.equal(old.input,latest.input)
})

test('dispose blocks pending file/result callbacks and StrictMode activation never revives old tokens',()=>{
  const session=new VisionSession(),file=session.replaceFile(),request=session.begin()
  session.dispose()
  assert.equal(session.accepts(request),false);assert.equal(session.acceptsFile(file),false)
  session.activate()
  assert.equal(session.accepts(request),false);assert.equal(session.acceptsFile(file),false)
  const currentFile=session.replaceFile(),current=session.begin()
  assert.equal(session.acceptsFile(currentFile),true);assert.equal(session.accepts(current),true)
})

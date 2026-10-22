import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = await readFile(new URL('../src/features/factory/growth/visualConfig.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const { validateVisual, defaultVisual, modelKindForType, appearanceKey } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const valid = { displayAlias: '北区循环泵', iconKey: 'pump', accentColor: '#4d7e8a' }
test('appearance is a small allowlist; business facts and arbitrary links cannot be saved', () => {
  assert.equal(validateVisual(valid).accentColor, '#4D7E8A')
  for (const input of [{ ...valid, status: 'normal' }, { ...valid, device_type: 'motor' }, { ...valid, iconKey: 'https://invalid/icon' }, { ...valid, accentColor: 'green' }, { ...valid, accentColor: '#123456;display:none' }]) assert.throws(() => validateVisual(input))
})
test('aliases support normal Unicode but reject format/control tricks, invalid lengths and non-strings', () => {
  for (const name of ['A', 'x'.repeat(25), '设备\u202E泵', '设备\n泵', 12]) assert.throws(() => validateVisual({ ...valid, displayAlias: name }))
  assert.equal(validateVisual({ ...valid, displayAlias: '  ' }).displayAlias, undefined)
  assert.equal(validateVisual({ ...valid, displayAlias: '<泵>' }).displayAlias, '<泵>') // React renders this as text.
  assert.equal(validateVisual({ ...valid, displayAlias: '电机😀' }).displayAlias, '电机😀')
})
test('local preferences are account/origin scoped and a stored record still passes the real schema', () => {
  assert.notEqual(appearanceKey(1, 'http://a'), appearanceKey(2, 'http://a'))
  assert.notEqual(appearanceKey(1, 'http://a'), appearanceKey(1, 'http://b'))
  assert.throws(() => appearanceKey(0, 'http://a'))
  assert.deepEqual(validateVisual(JSON.parse(JSON.stringify(valid))), { ...valid, accentColor:'#4D7E8A' })
  assert.throws(() => validateVisual(JSON.parse('{"iconKey":"pump","accentColor":"#ffffff","status":"fake"}')))
})
test('open business device types map to distinct defaults with an honest generic fallback', () => {
  assert.deepEqual(['pump', 'motor', 'compressor', 'unregistered'].map(modelKindForType), ['pump', 'motor', 'compressor', 'generic'])
  assert.equal(defaultVisual('unregistered').iconKey, 'machine')
  assert.notEqual(defaultVisual('pump').accentColor, defaultVisual('motor').accentColor)
})

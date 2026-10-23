import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = await readFile(new URL('../src/services/workspaceMode.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
const { legacyRedirect, factoryPath, factoryState, upperLevelPath, isSafeInternalPath, workspaceLink, normalizeStatus, normalizePanel, normalizeTool, areaFromPath, deviceDetailPath, toolPath, recordDetailPath, navigationContextPath } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const parsed = path => new URL(path, 'http://localhost')

test('factory legacy list retains search, status and device without creating a detail sidebar', () => {
  const result = parsed(legacyRedirect('/devices', '?device=pump-001&event=9&q=泵&status=fault&page=2&tab=history&channel=temperature'))
  assert.equal(result.pathname, '/dashboard')
  for (const [key,value] of Object.entries({device:'pump-001',event:'9',q:'泵',status:'fault',page:'2',channel:'temperature'})) assert.equal(result.searchParams.get(key),value)
  for (const key of ['view','panel','detail','tab']) assert.equal(result.searchParams.has(key),false)
})

test('old device path is authoritative and migrates to the one shared analysis page', () => {
  const result = parsed(legacyRedirect('/device/' + encodeURIComponent('pump / A'), '?device=wrong&event=5&tab=acoustic'))
  assert.equal(result.pathname, '/manage/devices/pump%20%2F%20A')
  assert.equal(result.searchParams.get('detail'),'acoustic')
  assert.equal(result.searchParams.get('event'),'5')
  assert.equal(result.searchParams.has('device'),false)
  assert.equal(result.searchParams.has('panel'),false)
})

test('all old diagnosis, event and report links reach the task owner with original evidence identity', () => {
  for (const [path, query, expected, section, tab] of [
    ['/diagnose','?device=pump-001&event=8','/tools/diagnosis',null,null],
    ['/diagnose','?tab=report&device=pump-001&event=8','/tools/events','report',null],
    ['/diagnose','?tab=trajectory&device=pump-001&event=8','/tools/events',null,'timeline'],
    ['/events','?device=pump-001&event=8','/tools/events',null,null],
    ['/reports','?device=pump-001&event=8','/tools/events','report',null],
  ]) {
    const result=parsed(legacyRedirect(path,query))
    assert.equal(result.pathname,expected)
    assert.equal(result.searchParams.get('device'),'pump-001')
    assert.equal(result.searchParams.get('event'),'8')
    assert.equal(result.searchParams.get('section'),section)
    assert.equal(result.searchParams.get('tab'),tab)
    assert.equal(result.searchParams.has('panel'),false)
  }
})

test('legacy dashboard panels and views cannot resurrect the removed factory expansion', () => {
  for (const key of ['panel','view']) {
    for (const [old, target] of [['device','/manage/devices/pump-001'],[key==='view'?'diagnose':'diagnosis','/tools/diagnosis'],['events','/tools/events'],[key==='view'?'reports':'report','/tools/events']]) {
      const result=parsed(legacyRedirect('/dashboard', `?${key}=${old}&device=pump-001&event=3`))
      assert.equal(result.pathname,target)
      assert.equal(result.searchParams.has('panel'),false)
      assert.equal(result.searchParams.has('view'),false)
    }
  }
  assert.equal(legacyRedirect('/dashboard','?view=devices&tab=inject&device=motor-001'),'/tools/simulation?device=motor-001')
})

test('research aliases preserve all original parameters and resolve the complete hierarchy', () => {
  for (const [old,target] of [['/about','/research'],['/about/research/signal','/research/signal'],['/about/research/signal/cwru','/research/signal/cwru']]) {
    const result=parsed(legacyRedirect(old,'?device=pump-001&event=3&q=abc'))
    assert.equal(result.pathname,target)
    assert.equal(result.searchParams.toString(),'device=pump-001&event=3&q=abc')
  }
  assert.equal(legacyRedirect('/lab'),'/research/signal')
  assert.equal(legacyRedirect('/ops','?tab=evolution'),'/research/mechanism')
})

test('canonical routes are idempotent and unknown tools retain a usable parent', () => {
  for (const input of [['/devices','?device=pump-001'],['/device/pump-001','?tab=latent'],['/reports','?event=4'],['/about/research/signal/cwru','?device=pump-001']]) {
    const url=parsed(legacyRedirect(...input))
    assert.equal(legacyRedirect(url.pathname,url.search),undefined)
  }
  for (const tool of ['diagnosis','events','simulation','vision','pico','evaluation','settings']) assert.equal(normalizeTool(tool),tool)
  assert.equal(legacyRedirect('/tools/not-a-tool'),'/tools')
  assert.equal(legacyRedirect('/admin/whatever'),'/admin/users')
  assert.equal(legacyRedirect('/unknown'),undefined)
})

test('invalid encoding and unsupported factory parameters are removed safely', () => {
  const result=parsed(legacyRedirect('/device/%E0%A4%A','?event=-2&page=NaN'))
  assert.equal(result.pathname,'/manage/devices')
  for (const key of ['event','page','device']) assert.equal(result.searchParams.has(key),false)
  const invalid=parsed(legacyRedirect('/dashboard','?view=wrong&event=-2&page=NaN&redirect=https://example.com'))
  for (const key of ['view','event','page','redirect']) assert.equal(invalid.searchParams.has(key),false)
})

test('path builders do not discard shared context or double encode device identity', () => {
  assert.equal(factoryPath({ device:'pump-001', panel:'device', detail:'history' }),'/manage/devices/pump-001?detail=history')
  assert.equal(factoryPath({ panel:'none',status:'all',page:1 }),'/dashboard')
  assert.equal(deviceDetailPath('pump / A','event=5&detail=acoustic'),'/manage/devices/pump%20%2F%20A?event=5&detail=acoustic')
  assert.equal(toolPath('events','pump-001',5,'report'),'/tools/events?device=pump-001&event=5&section=report')
  assert.equal(recordDetailPath(5),'/manage/records/5')
  assert.equal(workspaceLink('/tools/diagnosis','pump-001',5),'/tools/diagnosis?device=pump-001&event=5')
  assert.equal(parsed(workspaceLink('/events','pump-001',5)).pathname,'/tools/events')
})

test('parent routes reflect the shared read hierarchy and stable research tree', () => {
  assert.equal(upperLevelPath('/research/signal/cwru'),'/research/signal')
  assert.equal(upperLevelPath('/research/signal'),'/research')
  assert.equal(upperLevelPath('/research'),'/dashboard')
  assert.equal(upperLevelPath('/manage/devices/pump-001'),'/manage/devices')
  assert.equal(upperLevelPath('/manage/records/5'),'/manage/records')
  assert.equal(upperLevelPath('/tools/events'),'/tools')
  assert.equal(upperLevelPath('/dashboard'),null)
  assert.equal(areaFromPath('/manage/records/5'),'admin')
  assert.equal(areaFromPath('/research/signal/cwru'),'research')
})

test('Pico read navigation permits shared pages but rejects admin, external and encoded control paths', () => {
  for (const path of ['/dashboard?device=pump-001','/tools/diagnosis','/research/signal/cwru','/manage/devices/pump-001','/about/research/signal']) assert.equal(isSafeInternalPath(path),true,path)
  for (const path of ['/admin/users','/events','https://example.com','//evil.example','/dashboard\\evil','/tools/%5cadmin','/research/%0a','/manage/../admin/users','/research/%2e%2e/admin/users','/tools/./settings']) assert.equal(isSafeInternalPath(path),false,path)
  assert.equal(normalizeStatus('nope'),'all')
  assert.equal(normalizePanel('report'),'report') // Legacy parsing remains compatible until migration.
  assert.equal(factoryState('?event=0&page=0').eventId,undefined)
  assert.equal(factoryState('?event=0&page=0').page,1)
})

test('upward navigation exits shared detail identities while task links retain context', () => {
  assert.equal(navigationContextPath(upperLevelPath('/manage/records/4'), 'pump-001', 4), '/manage/records?device=pump-001')
  assert.equal(navigationContextPath(upperLevelPath('/manage/devices/pump-001'), 'pump-001', 4), '/manage/devices')
  assert.equal(navigationContextPath('/tools/events?section=report', 'pump-001', 4), '/tools/events?section=report&device=pump-001&event=4')
  assert.equal(navigationContextPath('/tools/events?device=motor-001&event=7', 'pump-001', 4), '/tools/events?device=motor-001&event=7')
})

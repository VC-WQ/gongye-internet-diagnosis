import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/services/workspaceMode.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022 },
})
const {
  legacyRedirect,
  factoryPath,
  factoryState,
  upperLevelPath,
  isSafeInternalPath,
  workspaceLink,
  normalizeStatus,
  normalizePanel,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function parsed(path) {
  const url = new URL(path, 'http://localhost')
  return { pathname: url.pathname, params: url.searchParams }
}

test('legacy flat routes migrate once into the single factory URL', () => {
  const devices = parsed(
    legacyRedirect(
      '/devices',
      '?device=compressor-001&event=9&q=air&status=fault&page=2&tab=history&channel=temperature',
    ),
  )
  assert.equal(devices.pathname, '/dashboard')
  assert.equal(devices.params.get('device'), 'compressor-001')
  assert.equal(devices.params.get('event'), '9')
  assert.equal(devices.params.get('q'), 'air')
  assert.equal(devices.params.get('status'), 'fault')
  assert.equal(devices.params.get('channel'), 'temperature')
  assert.equal(devices.params.has('view'), false)

  const device = parsed(
    legacyRedirect(
      '/device/' + encodeURIComponent('pump / A'),
      '?device=wrong&event=5&tab=acoustic',
    ),
  )
  assert.equal(device.params.get('device'), 'pump / A')
  assert.equal(device.params.get('panel'), 'device')
  assert.equal(device.params.get('detail'), 'acoustic')
  assert.equal(device.params.get('event'), '5')

  const report = parsed(legacyRedirect('/diagnose', '?tab=report&event=8'))
  assert.equal(report.params.get('panel'), 'report')
  const timeline = parsed(
    legacyRedirect('/diagnose', '?tab=trajectory&device=pump-001&event=8'),
  )
  assert.equal(timeline.params.get('panel'), 'events')
  assert.equal(timeline.params.get('tab'), 'timeline')
  assert.equal(timeline.params.get('event'), '8')

  for (const [path, expected] of [
    ['/events', 'events'],
    ['/reports', 'report'],
  ]) {
    const result = parsed(legacyRedirect(path, '?device=pump-001&event=3'))
    assert.equal(result.params.get('panel'), expected)
    assert.equal(result.params.get('device'), 'pump-001')
  }
})

test('legacy six-view dashboard and old tools routes are redirected, including simulation', () => {
  const scene = parsed(legacyRedirect('/dashboard', '?view=scene&device=pump-001'))
  assert.equal(scene.pathname, '/dashboard')
  assert.equal(scene.params.has('view'), false)
  assert.equal(scene.params.get('device'), 'pump-001')

  const detail = parsed(
    legacyRedirect('/dashboard', '?view=device&device=pump-001&tab=history'),
  )
  assert.equal(detail.params.get('panel'), 'device')
  assert.equal(detail.params.get('detail'), 'history')

  const simulation = legacyRedirect(
    '/dashboard',
    '?view=devices&tab=inject&device=motor-001',
  )
  assert.equal(simulation, '/tools/simulation?device=motor-001')

  assert.equal(legacyRedirect('/lab'), '/about/research/signal')
  assert.equal(legacyRedirect('/ops', '?tab=eval'), '/tools/evaluation')
  assert.equal(legacyRedirect('/ops', '?tab=threshold'), '/tools/settings')
  assert.equal(legacyRedirect('/ops', '?tab=evolution'), '/about/research/mechanism')
  assert.equal(legacyRedirect('/unknown'), undefined)
  assert.equal(legacyRedirect('/tools/not-a-tool'), '/tools')
  assert.equal(legacyRedirect('/admin/whatever'), '/admin/users')
})

test('legacy redirects are idempotent for canonical factory URLs', () => {
  const targets = [
    legacyRedirect('/devices', '?device=pump-001&status=degraded&q=泵'),
    legacyRedirect('/device/pump-001', '?event=4&tab=latent'),
    legacyRedirect('/diagnose', '?tab=report&device=pump-001&event=4'),
    legacyRedirect('/dashboard', '?view=events&device=pump-001&event=4&tab=timeline'),
  ]
  for (const target of targets) {
    assert.ok(target?.startsWith('/dashboard'))
    const url = new URL(target, 'http://localhost')
    assert.equal(legacyRedirect(url.pathname, url.search), undefined, target)
  }
})

test('malformed device ids and invalid numeric state normalize without throwing', () => {
  const malformed = parsed(legacyRedirect('/device/%E0%A4%A', '?event=-2&page=NaN'))
  assert.equal(malformed.pathname, '/dashboard')
  assert.equal(malformed.params.has('device'), false)
  assert.equal(malformed.params.has('event'), false)
  assert.equal(malformed.params.has('page'), false)
  const invalid = parsed(
    legacyRedirect(
      '/dashboard',
      '?view=wrong&event=-2&page=NaN&redirect=https://example.com',
    ),
  )
  assert.equal(invalid.params.has('view'), false)
  assert.equal(invalid.params.has('event'), false)
  assert.equal(invalid.params.has('page'), false)
  assert.equal(invalid.params.has('redirect'), false)
})

test('factory state and path helpers keep one canonical internal state', () => {
  assert.equal(normalizeStatus('fault'), 'fault')
  assert.equal(normalizeStatus('nope'), 'all')
  assert.equal(normalizePanel('report'), 'report')
  assert.equal(normalizePanel('view'), 'none')
  const state = factoryState(
    '?device=pump-001&event=12&status=degraded&panel=device&detail=latent&q=%E6%B3%B5&page=2&channel=acoustic',
  )
  assert.deepEqual(state, {
    deviceId: 'pump-001',
    eventId: 12,
    statusFilter: 'degraded',
    panel: 'device',
    detailTab: 'latent',
    subview: undefined,
    keyword: '泵',
    page: 2,
    channel: 'acoustic',
    evidence: undefined,
  })
  assert.equal(
    factoryPath({
      device: 'pump-001',
      event: 12,
      status: 'fault',
      panel: 'device',
      detail: 'history',
      q: '泵',
      page: 2,
    }),
    '/dashboard?device=pump-001&event=12&status=fault&panel=device&detail=history&q=%E6%B3%B5&page=2',
  )
  assert.equal(
    factoryPath({ panel: 'none', status: 'all', page: 1 }),
    '/dashboard',
  )
  assert.equal(factoryState('?event=0&page=0').eventId, undefined)
  assert.equal(factoryState('?event=0&page=0').page, 1)
})

test('upper level follows information hierarchy instead of history length', () => {
  assert.equal(
    upperLevelPath(
      '/dashboard',
      '?device=pump-001&status=fault&panel=diagnosis&q=泵',
    ),
    '/dashboard?device=pump-001&status=fault&q=%E6%B3%B5',
  )
  assert.equal(upperLevelPath('/dashboard', '?device=pump-001'), null)
  assert.equal(upperLevelPath('/tools/vision'), '/tools')
  assert.equal(upperLevelPath('/tools'), '/dashboard')
  assert.equal(
    upperLevelPath('/about/research/signal/cwru'),
    '/about/research/signal',
  )
  assert.equal(upperLevelPath('/about/research/signal'), '/about')
  assert.equal(upperLevelPath('/about'), '/dashboard')
  assert.equal(upperLevelPath('/admin/records'), '/admin/users')
})

test('Pico navigation only accepts the four new domains', () => {
  assert.equal(isSafeInternalPath('/dashboard?device=pump-001'), true)
  assert.equal(isSafeInternalPath('/tools/pico'), true)
  assert.equal(isSafeInternalPath('/about/research/signal'), true)
  assert.equal(isSafeInternalPath('/admin/users'), false)
  assert.equal(isSafeInternalPath('/events'), false)
  assert.equal(isSafeInternalPath('https://example.com'), false)
  assert.equal(isSafeInternalPath('//evil.example'), false)
  assert.equal(isSafeInternalPath('/dashboard\\evil'), false)
})

test('workspaceLink keeps old call sites working while writing new URLs', () => {
  const event = parsed(workspaceLink('/events', 'pump-001', 5))
  assert.equal(event.pathname, '/dashboard')
  assert.equal(event.params.get('panel'), 'events')
  assert.equal(event.params.get('device'), 'pump-001')
  assert.equal(event.params.get('event'), '5')
})

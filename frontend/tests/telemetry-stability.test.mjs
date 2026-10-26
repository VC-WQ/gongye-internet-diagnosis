import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const parser = ts.transpileModule(await readFile(new URL('../src/services/telemetry.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText

// Run the shipped hook with a deterministic React hook scheduler. The clock is
// allowed to change while resource/live references stay fixed, as in the app.
export async function telemetryHarness(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '').replace(/^export\s+\{[^}]+\}\s+from[^;]+;?\s*$/gm, '')
  return import(asModule(`
    import { parseSample as shippedParser } from ${JSON.stringify(asModule(parser))};
    export const runtime = { context: {}, data: [], live: { points: [] }, parses: 0, slots: [], index: 0 };
    const createContext = value => ({ value });
    const useContext = () => runtime.context;
    const useEffect = () => {};
    const useRef = value => ({ current: value });
    const useState = () => [runtime.live, () => {}];
    const useResource = () => ({ data: runtime.data, loading: false });
    const useMemo = (factory, deps) => {
      const index = runtime.index++, prior = runtime.slots[index];
      if (prior && deps.length === prior.deps.length && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
      const value = factory(); runtime.slots[index] = { deps, value }; return value;
    };
    const parseSample = (...args) => { runtime.parses++; return shippedParser(...args); };
    const getDevices = () => {};
    const getDeviceWindow = () => {};
    ${compiled}
    export const render = device => { runtime.index = 0; return useDeviceTelemetry(device); };
  `))
}

const shipped = await telemetryHarness(await readFile(new URL('../src/services/realtime.tsx', import.meta.url), 'utf8'))

test('clock-only refreshes preserve sample identity while stale changes on time', () => {
  const { runtime, render } = shipped
  const now = Date.now()
  runtime.slots = []; runtime.parses = 0; runtime.live = { points: [] }
  runtime.data = Array.from({ length: 64 }, (_, i) => ({ device_id: 'A', timestamp: now - (64 - i) * 1000, vibration: i }))
  runtime.context = { latest: {}, status: 'connected', now }
  const first = render('A')
  assert.equal(first.stale, false)
  let identityChanges = 1
  for (let tick = 1; tick <= 100; tick++) {
    runtime.context = { ...runtime.context, now: now + tick * 3000 }
    const next = render('A')
    if (next.samples !== first.samples) identityChanges++
    assert.equal(next.samples, first.samples)
    if (tick >= 6) assert.equal(next.stale, true)
  }
  assert.equal(runtime.parses, 64)
  assert.equal(identityChanges, 1)
})

test('new REST/live samples and device changes invalidate only their own sample view', () => {
  const { runtime, render } = shipped
  const now = Date.now()
  runtime.slots = []; runtime.live = { points: [] }
  runtime.data = [{ device_id: 'A', timestamp: now - 1000, vibration: 1 }]
  runtime.context = { latest: {}, status: 'connected', now }
  const first = render('A')
  runtime.live = { device: 'A', points: [{ device_id: 'A', timestamp: now, vibration: 2 }] }
  const live = render('A')
  assert.notEqual(live.samples, first.samples)
  assert.deepEqual(live.samples.map(point => point.vibration), [1, 2])
  runtime.data = [{ device_id: 'A', timestamp: now - 1000, vibration: 3 }]
  assert.equal(render('A').samples[0].vibration, 3)
  runtime.data = [{ device_id: 'B', timestamp: now, vibration: 8 }]
  const switched = render('B')
  assert.deepEqual(switched.samples.map(point => point.device_id), ['B'])
  assert.equal(switched.samples[0].vibration, 8)
})

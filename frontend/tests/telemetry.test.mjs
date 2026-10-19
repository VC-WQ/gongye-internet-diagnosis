import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

// Exercise the shipped parser with Node's test runner, without a second implementation.
const source = await readFile(new URL('../src/services/telemetry.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } })
const { parseSample, CHANNELS } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const now = 1792389600000

test('seconds, milliseconds and ISO timestamps represent the same sample time', () => {
  for (const timestamp of [now / 1000, now, new Date(now).toISOString()]) {
    const point = parseSample({ device_id: 'pump-A', timestamp, vibration: 1.2 }, 'pump-A', now)
    assert.equal(point.timestamp, now)
    assert.equal(point.vibration, 1.2)
  }
})
test('late device-A responses cannot become device-B samples', () => {
  assert.equal(parseSample({ device_id: 'A', timestamp: now, vibration: 123 }, 'B', now), undefined)
})
test('missing and invalid timestamps cannot be promoted to fresh sensor data', () => {
  for (const timestamp of [undefined, null, '', 'bad', NaN, Infinity, now + 60001]) {
    assert.equal(parseSample({ device_id: 'A', timestamp, vibration: 1 }, 'A', now), undefined)
  }
})
test('metadata and latent values alone do not count as sensor readings', () => {
  assert.equal(parseSample({ device_id: 'A', timestamp: now, latent_wear: .4, edge_anomaly_score: .5 }, 'A', now), undefined)
  for (const vibration of [undefined, null, '12', NaN, Infinity]) {
    assert.equal(parseSample({ device_id: 'A', timestamp: now, vibration }, 'A', now), undefined)
  }
})
test('zero and acoustic-only readings remain valid without fabrication', () => {
  assert.equal(parseSample({ device_id: 'A', timestamp: now, vibration: 0 }, 'A', now).vibration, 0)
  assert.equal(parseSample({ device_id: 'A', timestamp: now, acoustic: 61.4 }, 'A', now).acoustic, 61.4)
  assert.equal(CHANNELS.acoustic.unit, 'dB')
})
test('REST context can bind an identity, while unbound websocket frames are rejected', () => {
  assert.equal(parseSample({ timestamp: now, temperature: 29 }, 'A', now).device_id, 'A')
  assert.equal(parseSample({ timestamp: now, temperature: 29 }, undefined, now), undefined)
})
test('source metadata and historical timestamps survive parsing unchanged', () => {
  const point = parseSample({ device_id: 'A', timestamp: now - 30000, vibration: 2, source: 'simulation' }, 'A', now)
  assert.equal(point.timestamp, now - 30000)
  assert.equal(point.source, 'simulation')
})

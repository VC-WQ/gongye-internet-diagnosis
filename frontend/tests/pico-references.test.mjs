import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`
const catalogueSource = await readFile(new URL('../src/features/about/research.ts', import.meta.url), 'utf8')
const catalogueUrl = url(catalogueSource)
const referenceSource = await readFile(new URL('../src/features/pico/core/references.ts', import.meta.url), 'utf8')
const { referencePath } = await import(url(referenceSource.replaceAll("'../../about/research'", JSON.stringify(catalogueUrl))))
const { RESEARCH_TOPICS } = await import(catalogueUrl)

test('every real research topic and point citation reaches its canonical V2.3 page', () => {
  for (const topic of RESEARCH_TOPICS) {
    assert.equal(referencePath({ kind: 'research', id: topic.id }), `/research/${topic.id}`)
    for (const point of topic.points) {
      assert.equal(referencePath({ kind: 'research', id: `${topic.id}/${point.id}` }), `/research/${topic.id}/${point.id}`)
    }
  }
})

test('citations cannot invent a model, point or navigation destination', () => {
  for (const id of ['unknown', 'health/unknown-model', 'health/rul/extra', 'health/', '//evil.example', 'https://evil.example', '../admin/users', 'health/%2e%2e', 'health/rul?token=x']) {
    assert.equal(referencePath({ kind: 'research', id, source: '/admin/users' }), null, id)
  }
  assert.equal(referencePath({ kind: 'research', id: 'health/rul', source: 'javascript:alert(1)' }), '/research/health/rul')
})

test('file knowledge and business references do not masquerade as a research source page', () => {
  for (const kind of ['knowledge', 'device', 'event', 'report', 'telemetry']) {
    assert.equal(referencePath({ kind, id: 'health/rul', source: '/research/health/rul' }), null)
  }
})

import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { inspectEvidence, figureEvidence, comparisonRows, sourceBreakdown } = await loadTs('../src/features/about/dataContract.ts')
const { RESEARCH_TOPICS, PROVENANCE } = await loadTs('../src/features/about/research.ts')
const model = { name: 'fixture-model', accuracy: 0, precision: 0, recall: 0, f1: 0, auc: 0 }
const classification = { datasets: [{ name: 'fixture-task', models: [model], confusion_matrix: { tn: 0, fp: 0, fn: 0, tp: 0 }, roc: { fpr: [0, 1], tpr: [0, 0] } }] }

test('all declared figures have audited provenance; catalogue and source counts stay distinct', () => {
  const points = RESEARCH_TOPICS.flatMap(topic => topic.points)
  const figures = points.flatMap(point => point.figure ? [point.figure] : [])
  assert.equal(new Set(figures).size, Object.keys(PROVENANCE).length)
  assert.ok(points.some(point => !point.figure))
  for (const figure of figures) assert.ok(PROVENANCE[figure].source)
  assert.equal(PROVENANCE['digital-twin-phm'].kind, 'simulation')
  assert.equal(PROVENANCE['domain-adapt'].kind, 'mixed')
  assert.equal(PROVENANCE['self-evolution-loop'].kind, 'runtime')
})

test('missing, metadata-only, empty model arrays and malformed payloads never become available charts', () => {
  for (const figure of Object.keys(PROVENANCE)) {
    assert.equal(inspectEvidence(figure, {}).status, 'missing')
    assert.equal(inspectEvidence(figure, { _meta: { source: 'offline_experiment' } }).status, 'missing')
    assert.equal(inspectEvidence(figure, null).status, 'missing')
  }
  assert.equal(inspectEvidence('vision', { models: [] }).status, 'missing')
  assert.equal(inspectEvidence('classification', { datasets: [{ models: [model] }] }).status, 'incomplete')
})

test('zero-valued measured metrics remain available, while missing and non-finite fields are rejected', () => {
  assert.equal(inspectEvidence('classification', classification).status, 'available')
  const invalid = structuredClone(classification)
  invalid.datasets[0].models[0].auc = NaN
  assert.equal(inspectEvidence('classification', invalid).status, 'incomplete')
  invalid.datasets[0].models[0].auc = 0
  invalid.datasets[0].roc.tpr = [0]
  assert.equal(inspectEvidence('classification', invalid).status, 'incomplete')
})

test('regression preserves negative R2; prediction lengths and correlation dimensions must match', () => {
  const payload = { target_true: [1, 2], methods: [{ name: 'baseline', pred: [2, 3], rmse: 1, mae: 1, r2: -3 }] }
  const evidence = inspectEvidence('steam', payload)
  assert.equal(evidence.status, 'available')
  assert.equal(comparisonRows({ steam: evidence })[0].metrics[0].value, -3)
  payload.methods[0].pred.pop()
  assert.equal(inspectEvidence('steam', payload).status, 'incomplete')
  assert.equal(inspectEvidence('steam-analysis', { correlation: { names: ['a', 'b'], matrix: [[1, 0], [0, 1]] } }).status, 'available')
  assert.equal(inspectEvidence('steam-analysis', { correlation: { names: ['a', 'b'], matrix: [[1, 0]] } }).status, 'incomplete')
})

test('partial source failure cannot count stale results or hide other valid task/model observations', () => {
  const evidence = { classification: inspectEvidence('classification', classification), steam: { status: 'error', data: { methods: [{ name: 'stale', r2: 1 }] } }, vision: { status: 'missing' } }
  const rows = comparisonRows(evidence)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].task, 'fixture-task')
  assert.equal(rows[0].metrics[0].value, 0)
})

test('source breakdown never equates non-empty unknown source strings with public real data', () => {
  assert.deepEqual(sourceBreakdown([{ source: 'CWRU University' }, { source: '产线级仿真' }, { source: '公开数据集' }, { source: 'unverified' }, {}]), { simulated: 1, publicData: 2, unknown: 2 })
})


test('a multi-source figure is not counted available when its auxiliary experiment is missing', () => {
  const data = { target_true: [1], methods: [{ name: 'baseline', pred: [1], rmse: 0, mae: 0, r2: 1 }] }
  const steam = inspectEvidence('steam', data)
  assert.equal(figureEvidence('steam', { steam, 'steam-analysis': { status: 'missing', message: 'no correlation' } }).status, 'missing')
  assert.equal(figureEvidence('steam', { steam }).status, 'loading')
  assert.equal(figureEvidence('steam', { steam, 'steam-analysis': { status: 'available' } }).status, 'available')
  assert.equal(comparisonRows({ steam }).length, 1)
})

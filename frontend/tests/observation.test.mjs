import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = await readFile(new URL('../src/services/observation.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
const { observationOutcome } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('actual relapse response remains critical after server reconsults back to pending', () => {
  assert.equal(observationOutcome({ status_state: 'pending', feedback_result: { verdict: 'relapsed' } }), 'relapsed')
  assert.equal(observationOutcome({ status_state: 'pending' }), 'unknown')
})
test('explicit verdict distinguishes recovery and extended observation from current state', () => {
  assert.equal(observationOutcome({ status_state: 'recovered', feedback_result: { verdict: 'recovered' } }), 'recovered')
  assert.equal(observationOutcome({ status_state: 'observing', feedback_result: { verdict: 'extend' } }), 'observing')
})
test('old responses keep state compatibility and missing results never invent a relapse', () => {
  assert.equal(observationOutcome({ status_state: 'relapsed' }), 'relapsed')
  assert.equal(observationOutcome({ status_state: 'recovered' }), 'recovered')
  assert.equal(observationOutcome({ status_state: 'observing' }), 'observing')
  assert.equal(observationOutcome({}), 'unknown')
  assert.equal(observationOutcome(null), 'unknown')
})

import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = await readFile(new URL('../src/motion/contentPresence.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } })
const { initialContentPresence, requestContentPresence, finishContentPresence } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('presentation exits once while business target changes immediately; only latest enters', () => {
  let state = requestContentPresence(initialContentPresence('A'), 'B')
  assert.deepEqual([state.shownId, state.targetId, state.phase], ['A', 'B', 'exiting'])
  const exit = state.revision
  state = requestContentPresence(state, 'C')
  assert.deepEqual([state.shownId, state.targetId, state.revision], ['A', 'C', exit])
  state = finishContentPresence(state, exit)
  assert.deepEqual([state.shownId, state.phase], ['C', 'entering'])
  assert.equal(finishContentPresence(state, exit), state)
  state = finishContentPresence(state, state.revision)
  assert.equal(state.phase, 'idle')
})
test('reversal keeps shown identity and invalidates its old exit completion', () => {
  let state = requestContentPresence(initialContentPresence('A'), 'B')
  const old = state.revision
  state = requestContentPresence(state, 'A')
  assert.deepEqual([state.shownId, state.targetId, state.phase], ['A', 'A', 'entering'])
  assert.equal(finishContentPresence(state, old), state)
})
test('same identity refresh does not animate; reduced motion or resize commits latest exactly', () => {
  const state = initialContentPresence('A')
  assert.equal(requestContentPresence(state, 'A'), state)
  const moving = requestContentPresence(state, 'B')
  const settled = requestContentPresence(moving, 'C', true)
  assert.deepEqual([settled.shownId, settled.targetId, settled.phase], ['C', 'C', 'idle'])
  assert.equal(finishContentPresence(settled, moving.revision), settled)
})
test('hundreds of interruptions cannot resurrect an obsolete presentation', () => {
  let state = initialContentPresence('factory')
  const stale = []
  for (let i = 0; i < 400; i++) {
    const id = ['A', 'B', 'factory', 'error'][i % 4]
    state = requestContentPresence(state, id)
    for (const revision of stale) if (revision !== state.revision) assert.equal(finishContentPresence(state, revision), state)
    stale.push(state.revision)
    if (i % 3 === 0) state = finishContentPresence(state, state.revision)
    assert.equal(state.targetId, id)
  }
  state = requestContentPresence(state, 'FINAL')
  while (state.phase !== 'idle') state = finishContentPresence(state, state.revision)
  assert.equal(state.shownId, 'FINAL')
})

import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = await readFile(new URL('../src/features/management/batchDelete.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
const { deleteSelected } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('partial deletion reports only confirmed successes and preserves rejected identities', async () => {
  const calls = []
  const denied = new Error('denied')
  const result = await deleteSelected([1, 2, 3], async (id) => {
    calls.push(id)
    if (id === 2) throw denied
    return { deleted: true, id }
  })
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(result.deleted, [1, 3])
  assert.deepEqual(result.failed, [{ id: 2, error: denied }])
})

test('selection deduplicates real writes and catches synchronous adapter failures', async () => {
  const calls = []
  const rejected = new Error('adapter failed')
  const result = await deleteSelected(['pump-a', 'pump-a', 'pump-b'], (id) => {
    calls.push(id)
    if (id === 'pump-b') throw rejected
    return Promise.resolve({ deleted: true })
  })
  assert.deepEqual(calls, ['pump-a', 'pump-b'])
  assert.deepEqual(result.deleted, ['pump-a'])
  assert.equal(result.failed[0].id, 'pump-b')
  assert.equal(result.failed[0].error, rejected)
})

test('empty selection performs no API writes; retry targets the actual failed items only', async () => {
  let calls = 0
  const remove = async () => { calls += 1 }
  assert.deepEqual(await deleteSelected([], remove), { deleted: [], failed: [] })
  assert.equal(calls, 0)
  const first = await deleteSelected([7, 8], async (id) => { if (id === 8) throw new Error('temporary') })
  const retried = []
  const retry = await deleteSelected(first.failed.map(({ id }) => id), async (id) => { retried.push(id) })
  assert.deepEqual(retried, [8])
  assert.deepEqual(retry.deleted, [8])
  assert.deepEqual(retry.failed, [])
})

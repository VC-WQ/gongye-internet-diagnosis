import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/features/pico/core/presentation.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022 },
})
const { buildContextTitle, isNearBottom, metaDetails, shouldAutoRead } =
  await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  )

test('context is rendered once as area / device', () => {
  assert.equal(buildContextTitle('factory', '空压机 A'), '工厂 / 空压机 A')
  assert.equal(buildContextTitle('tools'), '工具')
  assert.equal(buildContextTitle('unknown'), '工作台')
})

test('auto scroll only follows when the reader is near the bottom', () => {
  assert.equal(
    isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 352 }),
    true,
  )
  assert.equal(
    isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 352 }),
    false,
  )
  assert.equal(
    isNearBottom({ scrollHeight: 1000, scrollTop: 620, clientHeight: 352 }, 20),
    false,
  )
})

test('metadata is a compact honest detail instead of a tag wall', () => {
  const rows = metaDetails({
    data_status: 'stale',
    source_kind: 'simulated',
    degraded: true,
    llm: 'unconfigured',
  })
  assert.deepEqual(rows, [
    { label: '数据时效', value: '已过期' },
    { label: '数据来源', value: '设备仿真' },
    { label: '回答方式', value: '内置模板（AI 服务未配置）' },
    { label: '质量提示', value: '部分证据不足，需人工复核' },
  ])
  assert.deepEqual(metaDetails(undefined), [])
})

test('auto read only fires for successful replies when available and enabled', () => {
  assert.equal(shouldAutoRead(true, 'answer', true), true)
  assert.equal(shouldAutoRead(false, 'answer', true), false)
  assert.equal(shouldAutoRead(true, 'error', true), false)
  assert.equal(shouldAutoRead(true, 'answer', false), false)
})

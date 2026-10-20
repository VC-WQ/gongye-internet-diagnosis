import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import * as echarts from 'echarts'

const source = await readFile(new URL('../src/theme/echarts.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } })
const { createChartTheme, xAxisBase, yAxisBase } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const light = {
  colorText: '#272521', colorTextSecondary: '#6b6861', colorBgElevated: '#ffffff',
  colorBorder: '#e4e1da', colorBorderSecondary: '#efede8', colorPrimary: '#c13d46',
  colorInfo: '#376c95', colorSuccess: '#348875', colorWarning: '#aa751f', colorError: '#c13d46',
  fontFamily: 'sans-serif',
}
const dark = { ...light, colorText: '#f2eee5', colorTextSecondary: '#b4aea2', colorBgElevated: '#2d2c29', colorBorder: '#3d3b35', colorBorderSecondary: '#34322d' }

for (const [name, token] of [['light', light], ['dark', dark]]) {
  test(`${name}: real ECharts model resolves helper axes, legend and tooltip from the active theme`, () => {
    const chart = echarts.init(null, createChartTheme(token), { renderer: 'svg', ssr: true, width: 480, height: 240 })
    try {
      const valueFormatter = value => `${value} mm/s`
      const series = [{ type: 'line', name: '实际采样', data: [2, 4], lineStyle: { color: '#348875' } }]
      chart.setOption({ animation: false, tooltip: { trigger: 'axis', valueFormatter }, legend: {},
        xAxis: xAxisBase({ type: 'category', data: ['A', 'B'] }), yAxis: yAxisBase({ type: 'value' }), series })
      const model = chart.getModel()
      assert.equal(model.getComponent('xAxis').get(['axisLabel', 'color']), token.colorTextSecondary)
      assert.equal(model.getComponent('yAxis').get(['axisLabel', 'color']), token.colorTextSecondary)
      assert.equal(model.getComponent('legend').get(['textStyle', 'color']), token.colorTextSecondary)
      assert.equal(model.getComponent('tooltip').get('backgroundColor'), token.colorBgElevated)
      assert.equal(model.getComponent('tooltip').get(['textStyle', 'color']), token.colorText)
      assert.equal(model.getComponent('tooltip').get('borderRadius'), 0)
      assert.equal(model.getComponent('tooltip').get('valueFormatter'), valueFormatter)
      assert.deepEqual(model.getSeriesByIndex(0).get('data'), [2, 4])
      assert.equal(model.getSeriesByIndex(0).get(['lineStyle', 'color']), '#348875')
      assert.ok(chart.renderToSVGString().includes(token.colorTextSecondary))
    } finally { chart.dispose() }
  })
}

test('axis overrides preserve business formatters and scale limits without injecting stale colors', () => {
  const formatter = value => `${value}s`
  const axis = xAxisBase({ min: 0, max: 120, axisLabel: { formatter } })
  assert.equal(axis.axisLabel.formatter, formatter)
  assert.equal(axis.min, 0)
  assert.equal(axis.max, 120)
  assert.equal(JSON.stringify(xAxisBase()).includes('color'), false)
  assert.equal(JSON.stringify(yAxisBase()).includes('color'), false)
})

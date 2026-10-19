import * as echarts from 'echarts'
export const TECH_DARK_THEME = 'tech-dark'
export const AXIS_LABEL_COLOR = '#697786'
export const AXIS_NAME_COLOR = '#697786'
export const AXIS_LINE_COLOR = '#b6c0c9'
export const AXIS_SPLIT_COLOR = '#e9edf1'
export function xAxisBase(extra: Record<string, unknown> = {}) {
  return {
    nameTextStyle: { color: AXIS_NAME_COLOR, fontSize: 11 },
    axisLine: { show: true, lineStyle: { color: AXIS_LINE_COLOR } },
    axisTick: { show: false },
    axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11, hideOverlap: true },
    splitLine: { show: false },
    ...extra,
  }
}
export function yAxisBase(extra: Record<string, unknown> = {}) {
  return {
    ...xAxisBase(),
    splitLine: { show: true, lineStyle: { color: AXIS_SPLIT_COLOR } },
    ...extra,
  }
}
export function registerTechDarkTheme() {
  // Preserve the legacy theme identifier for existing research components.
  const base = {
    color: ['#477d9e', '#4b9b88', '#c39752', '#b56570', '#7c82a8', '#7d9f5a'],
    backgroundColor: 'transparent',
    textStyle: { color: '#536170' },
    title: {
      textStyle: { color: '#27323e' },
      subtextStyle: { color: '#788695' },
    },
    legend: { textStyle: { color: '#697786' } },
    tooltip: {
      backgroundColor: '#fff',
      borderColor: '#dce3e9',
      textStyle: { color: '#293543' },
    },
    categoryAxis: xAxisBase(),
    valueAxis: yAxisBase(),
    logAxis: yAxisBase(),
    timeAxis: xAxisBase(),
  }
  echarts.registerTheme('tech-dark', base)
  const darkAxis = {
    axisLabel: { color: '#9cb0be', fontSize: 9, hideOverlap: true },
    nameTextStyle: { color: '#9cb0be', fontSize: 10 },
    axisLine: { lineStyle: { color: '#425765' } },
    splitLine: { lineStyle: { color: '#2b3e4c' } },
  }
  echarts.registerTheme('control-dark', {
    ...base,
    textStyle: { color: '#c4d1dc' },
    legend: { textStyle: { color: '#a0b3c1' } },
    tooltip: {
      backgroundColor: '#203442',
      borderColor: '#465e6e',
      textStyle: { color: '#e1e8ed' },
    },
    categoryAxis: darkAxis,
    valueAxis: darkAxis,
    timeAxis: darkAxis,
  })
}
registerTechDarkTheme()

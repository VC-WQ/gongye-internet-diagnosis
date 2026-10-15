import * as echarts from 'echarts'

// 深色科技大屏统一图表主题名（echarts-for-react 的 theme 属性引用）
export const TECH_DARK_THEME = 'tech-dark'

// 语义色（与全局 CSS / Antd token 保持一致）
const axisLine = 'rgba(148, 163, 184, 0.55)'
const splitLine = 'rgba(148, 163, 184, 0.18)'
const labelColor = '#ffffff'

// 通用坐标轴样式：保证深色背景下坐标轴、刻度、标签清晰可见（横轴不丢失）
export const AXIS_LABEL_COLOR = '#ffffff'
export const AXIS_NAME_COLOR = '#ffffff'
export const AXIS_LINE_COLOR = 'rgba(148, 163, 184, 0.55)'
export const AXIS_SPLIT_COLOR = 'rgba(148, 163, 184, 0.15)'

// 轴名称统一样式：纯白、无描边无阴影（echarts 默认 nameTextStyle 为深色，
// 深色背景下不可见；显式关闭描边，避免出现"白边裹深色字"的渲染效果）
const axisNameStyle = {
  color: '#ffffff',
  fontSize: 12,
  fontWeight: 500 as const,
  textBorderColor: 'rgba(0,0,0,0)',
  textBorderWidth: 0,
  shadowBlur: 0,
  shadowColor: 'rgba(0,0,0,0)',
}

// X 轴基础样式（显式显示轴线 / 刻度 / 标签 / 轴名，避免被深色背景吞掉）
export function xAxisBase(extra: Record<string, unknown> = {}) {
  return {
    nameTextStyle: axisNameStyle,
    axisLine: { show: true, lineStyle: { color: AXIS_LINE_COLOR } },
    axisTick: { show: true, lineStyle: { color: AXIS_LINE_COLOR } },
    axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11 },
    splitLine: { show: false },
    ...extra,
  }
}

// Y 轴基础样式（保留淡横向网格线，便于读数）
export function yAxisBase(extra: Record<string, unknown> = {}) {
  return {
    nameTextStyle: axisNameStyle,
    axisLine: { show: true, lineStyle: { color: AXIS_LINE_COLOR } },
    axisTick: { show: true, lineStyle: { color: AXIS_LINE_COLOR } },
    axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: AXIS_SPLIT_COLOR } },
    ...extra,
  }
}

/**
 * 深色科技主题：透明背景 + 冷灰轴线 + 青蓝数据配色。
 * 覆盖所有 echarts-for-react 实例的默认浅色外观。
 */
const techDarkTheme = {
  color: [
    '#22d3ee',
    '#38bdf8',
    '#52c41a',
    '#faad14',
    '#f5222d',
    '#a78bfa',
    '#f472b6',
    '#2dd4bf',
  ],
  backgroundColor: 'transparent',
  textStyle: { color: labelColor },
  title: {
    textStyle: { color: '#e6edf7' },
    subtextStyle: { color: '#8fa3bd' },
  },
  legend: { textStyle: { color: '#b6c4d9' } },
  tooltip: {
    backgroundColor: '#101b30',
    borderColor: 'rgba(148, 163, 184, 0.28)',
    textStyle: { color: '#e6edf7' },
    extraCssText: 'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); border-radius: 8px;',
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: axisLine } },
    axisTick: { lineStyle: { color: axisLine } },
    axisLabel: { color: labelColor },
    nameTextStyle: { color: labelColor },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: axisLine } },
    axisLabel: { color: labelColor },
    nameTextStyle: { color: labelColor },
    splitLine: { lineStyle: { color: splitLine } },
  },
  logAxis: {
    axisLine: { lineStyle: { color: axisLine } },
    axisLabel: { color: labelColor },
    nameTextStyle: { color: labelColor },
    splitLine: { lineStyle: { color: splitLine } },
  },
  timeAxis: {
    axisLine: { lineStyle: { color: axisLine } },
    axisLabel: { color: labelColor },
    nameTextStyle: { color: labelColor },
    splitLine: { lineStyle: { color: splitLine } },
  },
}

// 全局注册一次（在 main.tsx 中调用）
export function registerTechDarkTheme() {
  echarts.registerTheme(TECH_DARK_THEME, techDarkTheme)
}

// 模块加载即注册：本文件被 HMR 热更新后立即重新注册主题，
// 避免主题改动后浏览器仍使用旧主题（轴名等文字颜色不生效的根因）。
registerTechDarkTheme()
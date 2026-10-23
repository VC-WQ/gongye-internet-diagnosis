/** 图表只保留布局/字号默认值；文字和表面颜色由当前 AntD 主题提供。 */
export function xAxisBase(extra: Record<string, unknown> = {}) {
  return {
    nameTextStyle: { fontSize: 11 },
    axisLine: { show: true },
    axisTick: { show: false },
    axisLabel: { fontSize: 11, hideOverlap: true },
    splitLine: { show: false },
    ...extra,
  }
}
export function yAxisBase(extra: Record<string, unknown> = {}) {
  return { ...xAxisBase(), splitLine: { show: true }, ...extra }
}

export interface ChartTokens {
  colorText: string
  colorTextSecondary: string
  colorBgElevated: string
  colorBorder: string
  colorBorderSecondary: string
  colorPrimary: string
  colorInfo: string
  colorSuccess: string
  colorWarning: string
  colorError: string
  fontFamily: string
}

/** 返回真实颜色值供 Canvas 使用，避免把无法解析的 CSS var 传给绘图器。 */
export function createChartTheme(token: ChartTokens) {
  const axis = {
    nameTextStyle: { color: token.colorTextSecondary, fontSize: 11 },
    axisLabel: { color: token.colorTextSecondary, fontSize: 11, hideOverlap: true },
    axisLine: { lineStyle: { color: token.colorBorder } },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: token.colorBorderSecondary } },
  }
  return {
    backgroundColor: 'transparent',
    color: [token.colorInfo, token.colorSuccess, token.colorWarning, token.colorPrimary, '#8676a0', '#a56f89'],
    textStyle: { color: token.colorText, fontFamily: token.fontFamily },
    title: { textStyle: { color: token.colorText }, subtextStyle: { color: token.colorTextSecondary } },
    legend: { textStyle: { color: token.colorTextSecondary }, pageTextStyle: { color: token.colorTextSecondary } },
    tooltip: {
      backgroundColor: token.colorBgElevated,
      borderColor: token.colorBorder,
      borderRadius: 0,
      textStyle: { color: token.colorText },
      extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,.12);',
    },
    visualMap: { textStyle: { color: token.colorTextSecondary } },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
    logAxis: axis,
    timeAxis: { ...axis, splitLine: { show: false } },
    dataZoom: { textStyle: { color: token.colorTextSecondary }, borderColor: token.colorBorder },
  }
}

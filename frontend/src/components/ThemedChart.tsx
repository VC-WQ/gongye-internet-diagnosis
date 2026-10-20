import { useMemo } from 'react'
import { theme } from 'antd'
import ReactECharts from 'echarts-for-react'
import type { EChartsReactProps } from 'echarts-for-react/lib/types'
import { createChartTheme } from '../theme/echarts'

/** 主题对象仅在实际配色改变时更新，采样刷新不销毁重建图表。 */
export default function ThemedChart(props: Omit<EChartsReactProps, 'theme'>) {
  const { token } = theme.useToken()
  const {
    colorText, colorTextSecondary, colorBgElevated, colorBorder, colorBorderSecondary,
    colorPrimary, colorInfo, colorSuccess, colorWarning, colorError, fontFamily,
  } = token
  const chartTheme = useMemo(() => createChartTheme({
    colorText, colorTextSecondary, colorBgElevated, colorBorder, colorBorderSecondary,
    colorPrimary, colorInfo, colorSuccess, colorWarning, colorError, fontFamily,
  }), [colorText, colorTextSecondary, colorBgElevated, colorBorder, colorBorderSecondary,
    colorPrimary, colorInfo, colorSuccess, colorWarning, colorError, fontFamily])
  const option = useMemo(() => ({ ...props.option, ...(token.motion === false ? { animation: false } : {}) }), [props.option, token.motion])
  return <ReactECharts {...props} option={option} theme={chartTheme} />
}

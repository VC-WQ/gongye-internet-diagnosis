import { useLayoutEffect, useMemo, useRef } from 'react'
import { theme } from 'antd'
import echarts from './chartLibrary'
import type { EChartsType } from 'echarts'
import type { EChartsReactProps } from 'echarts-for-react/lib/types'
import { createChartTheme } from '../theme/echarts'

type ChartProps = Omit<EChartsReactProps, 'theme'>

/** 同步创建并成对释放，避免 finished 回调在卸载后重建实例。 */
export default function ThemedChart(props: Omit<EChartsReactProps, 'theme'>) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<EChartsType>()
  const previous = useRef<{ chart: EChartsType; props: ChartProps; option: unknown }>()
  const handlers = useRef(new Map<string, (params: unknown) => void>())
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
  const library = props.echarts ?? echarts
  const { renderer, devicePixelRatio, width, height, locale } = props.opts ?? {}

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const chart: EChartsType = library.init(element, chartTheme, { renderer, devicePixelRatio, width, height, locale })
    instance.current = chart
    let frame = 0
    let lastWidth = element.clientWidth
    let lastHeight = element.clientHeight
    const observer = new ResizeObserver(() => {
      if (!element.isConnected || chart.isDisposed()) return
      const nextWidth = element.clientWidth
      const nextHeight = element.clientHeight
      if (!nextWidth || !nextHeight || (nextWidth === lastWidth && nextHeight === lastHeight)) return
      lastWidth = nextWidth
      lastHeight = nextHeight
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!chart.isDisposed() && element.isConnected) chart.resize()
      })
    })
    if (props.autoResize !== false) observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      handlers.current.clear()
      previous.current = undefined
      instance.current = undefined
      chart.dispose()
    }
  }, [library, chartTheme, renderer, devicePixelRatio, width, height, locale, props.autoResize])

  useLayoutEffect(() => {
    const chart = instance.current
    if (!chart || chart.isDisposed()) return
    const prior = previous.current
    const initial = prior?.chart !== chart
    if (initial || prior.props.onEvents !== props.onEvents) {
      handlers.current.forEach((handler, event) => chart.off(event, handler))
      handlers.current.clear()
      Object.entries(props.onEvents ?? {}).forEach(([event, callback]) => {
        const handler = (params: unknown) => callback(params, chart)
        handlers.current.set(event, handler)
        chart.on(event, handler)
      })
    }
    if (initial || (props.shouldSetOption?.(prior.props, props) !== false &&
      (prior.option !== option || prior.props.notMerge !== props.notMerge || prior.props.replaceMerge !== props.replaceMerge || prior.props.lazyUpdate !== props.lazyUpdate))) {
      chart.setOption(option, { notMerge: props.notMerge, replaceMerge: props.replaceMerge, lazyUpdate: props.lazyUpdate })
    }
    if (props.showLoading) chart.showLoading(props.loadingOption)
    else chart.hideLoading()
    previous.current = { chart, props, option }
    if (initial) props.onChartReady?.(chart)
  })

  const { option: _option, echarts: _echarts, opts: _opts, notMerge: _notMerge, replaceMerge: _replaceMerge,
    lazyUpdate: _lazyUpdate, showLoading: _showLoading, loadingOption: _loadingOption, onChartReady: _onChartReady,
    onEvents: _onEvents, shouldSetOption: _shouldSetOption, autoResize: _autoResize, style, className, ...attributes } = props
  return <div {...attributes} ref={host} className={`echarts-for-react ${className ?? ''}`} style={{ height: 300, ...style }} />
}

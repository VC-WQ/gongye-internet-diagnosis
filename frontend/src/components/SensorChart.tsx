import ThemedChart from './ThemedChart'
import { Empty, theme } from 'antd'
import { CHANNELS, type Sample } from '../services/realtime'

export default function SensorChart({
  samples,
  channel = 'vibration',
  height = 200,
}: {
  samples: Sample[]
  channel?: string
  height?: number
}) {
  const { token } = theme.useToken()
  const meta = CHANNELS[channel]
  const points = samples.filter(
    (p) => typeof p[channel] === 'number' && Number.isFinite(p[channel]),
  )
  if (!points.length)
    return (
      <div className="chart-empty" style={{ minHeight: height }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`暂无${meta?.name ?? '传感器'}数据`}
        />
      </div>
    )
  return (
    <ThemedChart
      style={{ height }}
      option={{
        animation: false,
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v: number) => `${v.toFixed(3)} ${meta?.unit ?? ''}`,
        },
        grid: { left: 44, right: 14, top: 30, bottom: 30 },
        xAxis: {
          type: 'time',
          axisLabel: { formatter: '{HH}:{mm}:{ss}', hideOverlap: true },
          splitNumber: 3,
        },
        yAxis: { type: 'value', name: meta?.unit, scale: true, splitNumber: 3 },
        series: [
          {
            type: 'line',
            name: meta?.name,
            showSymbol: false,
            smooth: false,
            data: points.map((p) => [p.timestamp, p[channel]]),
            lineStyle: { width: 2, color: token.colorSuccess },
            areaStyle: {
              color: token.colorSuccess, opacity: 0.06,
            },
          },
        ],
      }}
    />
  )
}

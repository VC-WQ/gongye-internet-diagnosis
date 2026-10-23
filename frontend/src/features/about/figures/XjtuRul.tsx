import { useMemo, useState } from 'react'
import { Card, Empty, Select, Space } from 'antd'
import ThemedChart from '../../../components/ThemedChart'
import ChartNote from '../../../components/ChartNote'
import { LoadState } from '../../../components/BusinessUI'
import { getXjtuRul } from '../../../services/api'
import { useResource } from '../../../hooks/useResource'
import { xAxisBase, yAxisBase } from '../../../theme/echarts'

interface Bearing {
  id: string
  condition: string
  lifetime_min: number
  series: Array<{ t: number; hi: number; rul: number }>
}

export default function XjtuRul() {
  const resource = useResource('viz-xjtu-rul', getXjtuRul)
  const bearings: Bearing[] = resource.data?.bearings ?? []
  const [bearingId, setBearingId] = useState<string>()
  const selectedId = bearingId ?? bearings[0]?.id
  const bearing = bearings.find((item) => item.id === selectedId)

  const option = useMemo(() => {
    if (!bearing) return {}
    return {
      animation: false,
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 58, right: 52, top: 40, bottom: 55 },
      xAxis: xAxisBase({
        type: 'value',
        name: '时间（分钟）',
        nameLocation: 'middle',
        nameGap: 30,
      }),
      yAxis: yAxisBase({ type: 'value', name: '指标值（0–1）', min: 0, max: 1 }),
      series: [
        {
          name: '健康指标 HI',
          type: 'line',
          showSymbol: false,
          smooth: false,
          data: bearing.series.map((point) => [point.t, point.hi]),
          lineStyle: { color: '#327a60' },
          itemStyle: { color: '#327a60' },
        },
        {
          name: '剩余寿命 RUL',
          type: 'line',
          showSymbol: false,
          smooth: false,
          data: bearing.series.map((point) => [point.t, point.rul]),
          lineStyle: { color: '#406783', type: 'dashed' },
          itemStyle: { color: '#406783' },
        },
      ],
    }
  }, [bearing])

  return (
    <LoadState
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.refresh}
      empty={!resource.loading && !bearings.length}
      emptyText="暂无全寿命退化数据"
    >
      <Card
        title="轴承全寿命退化曲线（XJTU-SY）"
        extra={
          <Space size={10}>
            {bearings.length > 0 && (
              <Select
                size="small"
                style={{ width: 190 }}
                aria-label="选择轴承"
                value={selectedId}
                onChange={setBearingId}
                options={bearings.map((item) => ({
                  value: item.id,
                  label: `${item.id}（${item.condition}）`,
                }))}
              />
            )}
            <ChartNote
              desc="单根轴承全寿命的健康指标 HI与剩余寿命 RUL 随时间演化的退化曲线。"
              dataSource="XJTU-SY 西安交大轴承全寿命加速退化数据集（15 根轴承双通道振动，真实公开数据）。"
              insight="HI 的整体退化趋势是寿命预测的建模依据；SDE 状态方程刻画的正是这条曲线的自加速段。"
            />
          </Space>
        }
      >
        {bearing ? (
          <ThemedChart option={option} style={{ height: 320 }} />
        ) : (
          <Empty description="数据准备中" />
        )}
      </Card>
    </LoadState>
  )
}

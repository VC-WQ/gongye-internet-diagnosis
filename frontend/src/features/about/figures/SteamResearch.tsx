import { useMemo } from 'react'
import { Card, Empty, Table } from 'antd'
import ThemedChart from '../../../components/ThemedChart'
import ChartNote from '../../../components/ChartNote'
import { LoadState } from '../../../components/BusinessUI'
import { getSteamAnalysis, getSteamMl } from '../../../services/api'
import { useResource } from '../../../hooks/useResource'
import { xAxisBase, yAxisBase } from '../../../theme/echarts'

interface SteamMethod {
  name: string
  pred: number[]
  mse: number
  rmse: number
  mae: number
  r2: number
}
interface SteamMlData {
  target_true: number[]
  methods: SteamMethod[]
  feature_importance: Array<{ feature: string; importance: number }>
}
interface Correlation {
  names: string[]
  matrix: number[][]
}

const COLORS: Record<string, string> = {
  线性回归: '#38bdf8',
  岭回归: '#52c41a',
  随机森林: '#fa8c16',
  梯度提升: '#722ed1',
  XGBoost: '#eb2f96',
}

export default function SteamResearch() {
  const ml = useResource('viz-steam-ml', getSteamMl)
  const analysis = useResource('viz-steam', getSteamAnalysis)
  const data: SteamMlData | undefined = ml.data
  const correlation: Correlation | undefined = analysis.data?.correlation
  const scatterOption = useMemo(() => {
    if (!data?.methods?.length) return {}
    const truth = data.target_true
    const min = Math.min(...truth)
    const max = Math.max(...truth)
    return {
      animation: false,
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 58, right: 24, top: 40, bottom: 58 },
      xAxis: xAxisBase({
        type: 'value',
        name: '真实值',
        min,
        max,
        nameLocation: 'middle',
        nameGap: 30,
      }),
      yAxis: yAxisBase({ type: 'value', name: '预测值', min, max }),
      series: [
        ...data.methods.map((method) => ({
          name: method.name,
          type: 'scatter',
          symbolSize: 5,
          data: truth.map((value, index) => [value, method.pred[index]]),
          itemStyle: { color: COLORS[method.name] ?? '#94a3b8' },
        })),
        {
          name: '理想线 y=x',
          type: 'line',
          showSymbol: false,
          data: [
            [min, min],
            [max, max],
          ],
          lineStyle: { color: '#94a3b8', type: 'dashed' },
        },
      ],
    }
  }, [data])
  const importanceOption = useMemo(() => {
    if (!data?.feature_importance?.length) return {}
    const top = data.feature_importance.slice(0, 15).reverse()
    return {
      animation: false,
      tooltip: { trigger: 'axis' },
      grid: { left: 100, right: 44, top: 20, bottom: 45 },
      xAxis: xAxisBase({ type: 'value', name: '特征重要性' }),
      yAxis: yAxisBase({
        type: 'category',
        data: top.map((item) => item.feature),
      }),
      series: [
        {
          type: 'bar',
          data: top.map((item) => item.importance),
          itemStyle: { color: '#fa8c16' },
          label: { show: true, position: 'right' },
        },
      ],
    }
  }, [data])
  const heatmapOption = useMemo(() => {
    if (!correlation?.matrix?.length) return {}
    const points: Array<[number, number, number]> = []
    correlation.matrix.forEach((row, rowIndex) =>
      row.forEach((value, columnIndex) =>
        points.push([columnIndex, rowIndex, value]),
      ),
    )
    return {
      animation: false,
      tooltip: { position: 'top' },
      grid: { left: 74, right: 24, top: 24, bottom: 80 },
      xAxis: xAxisBase({
        type: 'category',
        data: correlation.names,
        name: '特征',
        nameLocation: 'middle',
        nameGap: 52,
        axisLabel: { fontSize: 9, rotate: 90, interval: 0 },
        splitArea: { show: true },
      }),
      yAxis: yAxisBase({
        type: 'category',
        data: correlation.names,
        axisLabel: { fontSize: 9, interval: 0 },
        splitArea: { show: true },
      }),
      visualMap: {
        min: -1,
        max: 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 6,
        itemWidth: 14,
        itemHeight: 180,
        inRange: { color: ['#406783', '#ece6dc', '#b24b55'] },
      },
      series: [
        {
          type: 'heatmap',
          data: points,
          label: { show: false },
          emphasis: { itemStyle: { borderColor: '#64748b', borderWidth: 1 } },
        },
      ],
    }
  }, [correlation])

  return (
    <LoadState
      loading={ml.loading || analysis.loading}
      error={ml.error || analysis.error}
      onRetry={() => {
        ml.refresh()
        analysis.refresh()
      }}
      empty={!ml.loading && !data}
      emptyText="暂无通用算法横评数据"
    >
      <div className="research-grid">
        <Card
          title="蒸汽量预测 · sklearn / XGBoost 多模型对比"
          extra={
            <ChartNote
              desc="五种回归模型在蒸汽量预测上的真实值 vs 预测值散点，叠加 y=x 理想线。"
              dataSource="工业蒸汽量预测数据集（2888 样本 · 38 维特征，真实公开数据）。"
              insight="散点越贴近理想线，回归越准确。"
            />
          }
        >
          {data ? (
            <ThemedChart option={scatterOption} style={{ height: 300 }} />
          ) : (
            <Empty description="数据准备中" />
          )}
        </Card>
        <Card
          title="蒸汽量 · 树模型特征重要性"
          extra={
            <ChartNote
              desc="随机森林在蒸汽量回归任务上的前 15 维特征重要性。"
              dataSource="工业蒸汽量预测数据集（38 维传感器特征，真实公开数据）。"
              insight="重要性越高，对蒸汽量预测的贡献越大。"
            />
          }
        >
          {data ? (
            <ThemedChart option={importanceOption} style={{ height: 300 }} />
          ) : (
            <Empty description="数据准备中" />
          )}
        </Card>
        <Card title="蒸汽量回归 · 模型指标对比">
          <Table
            size="small"
            rowKey="name"
            pagination={false}
            columns={[
              { title: '模型', dataIndex: 'name' },
              { title: 'R²', dataIndex: 'r2' },
              { title: 'RMSE', dataIndex: 'rmse' },
              { title: 'MAE', dataIndex: 'mae' },
            ]}
            dataSource={data?.methods ?? []}
          />
        </Card>
        <Card
          title="蒸汽传感器特征相关性热力图"
          extra={
            <ChartNote
              desc="38 维传感器特征两两之间的线性相关系数（红=正相关，蓝=负相关）。"
              dataSource="工业蒸汽量预测数据集（38 维传感器特征 V0–V37，真实公开数据）。"
              insight="识别高度相关的冗余特征，为降维与特征工程提供依据。"
            />
          }
        >
          {correlation ? (
            <ThemedChart option={heatmapOption} style={{ height: 380 }} />
          ) : (
            <Empty description="数据准备中" />
          )}
        </Card>
      </div>
    </LoadState>
  )
}

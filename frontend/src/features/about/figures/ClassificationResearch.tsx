import { useMemo } from 'react'
import { Card, Empty, Table } from 'antd'
import ThemedChart from '../../../components/ThemedChart'
import ChartNote from '../../../components/ChartNote'
import { LoadState } from '../../../components/BusinessUI'
import { getClassification } from '../../../services/api'
import { useResource } from '../../../hooks/useResource'
import { xAxisBase, yAxisBase } from '../../../theme/echarts'

interface ModelMetric {
  name: string
  accuracy: number
  precision: number
  recall: number
  f1: number
  auc: number
}
interface Dataset {
  name: string
  samples: number
  features_dim: number
  best_model: string
  models: ModelMetric[]
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number }
  roc: { fpr: number[]; tpr: number[] }
  feature_importance: Array<{ feature: string; importance: number }>
}

function confusionOption(dataset: Dataset) {
  const { tn, fp, fn, tp } = dataset.confusion_matrix
  const max = Math.max(tn, fp, fn, tp)
  return {
    animation: false,
    tooltip: {
      formatter: (point: { data: [number, number, number] }) =>
        `预测${point.data[0] === 0 ? '正常' : '故障'} / 实际${point.data[1] === 0 ? '正常' : '故障'}：${point.data[2]} 例`,
    },
    grid: { left: 64, right: 24, top: 30, bottom: 52 },
    xAxis: xAxisBase({
      type: 'category',
      data: ['正常', '故障'],
      name: '预测',
      nameLocation: 'middle',
      nameGap: 30,
    }),
    yAxis: yAxisBase({ type: 'category', data: ['故障', '正常'], name: '实际' }),
    visualMap: {
      min: 0,
      max,
      show: false,
      inRange: { color: ['#f2e9e5', '#aa454e'] },
    },
    series: [
      {
        type: 'heatmap',
        data: [
          [0, 0, fp],
          [1, 0, tp],
          [0, 1, tn],
          [1, 1, fn],
        ],
        label: {
          show: true,
          fontSize: 16,
          fontWeight: 700,
          formatter: (point: { value: number[] }) =>
            `{${point.value[2] > max / 2 ? 'high' : 'low'}|${point.value[2]}}`,
          rich: { high: { color: '#fff' }, low: { color: '#272521' } },
        },
        itemStyle: { borderColor: '#e4e1da', borderWidth: 1 },
      },
    ],
  }
}

const columns = [
  { title: '模型', dataIndex: 'name' },
  { title: '准确率', dataIndex: 'accuracy' },
  { title: '精确率', dataIndex: 'precision' },
  { title: '召回率', dataIndex: 'recall' },
  { title: 'F1', dataIndex: 'f1' },
  { title: 'AUC', dataIndex: 'auc' },
]

export default function ClassificationResearch() {
  const resource = useResource('viz-classification', getClassification)
  const datasets: Dataset[] = resource.data?.datasets ?? []
  const rocOption = useMemo(() => {
    if (!datasets.length) return {}
    return {
      animation: false,
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 58, right: 24, top: 40, bottom: 58 },
      xAxis: xAxisBase({
        type: 'value',
        name: '假正率 FPR',
        min: 0,
        max: 1,
        nameLocation: 'middle',
        nameGap: 30,
      }),
      yAxis: yAxisBase({ type: 'value', name: '真正率 TPR', min: 0, max: 1 }),
      series: [
        ...datasets.map((dataset) => ({
          name: dataset.name,
          type: 'line',
          showSymbol: false,
          smooth: false,
          data: dataset.roc.fpr.map((value, index) => [
            value,
            dataset.roc.tpr[index],
          ]),
        })),
        {
          name: '随机基线',
          type: 'line',
          showSymbol: false,
          data: [
            [0, 0],
            [1, 1],
          ],
          lineStyle: { color: '#94a3b8', type: 'dashed' },
        },
      ],
    }
  }, [datasets])
  const importanceOption = useMemo(() => {
    const dataset = datasets[0]
    if (!dataset?.feature_importance?.length) return {}
    const top = dataset.feature_importance.slice(0, 15).reverse()
    return {
      animation: false,
      tooltip: { trigger: 'axis' },
      grid: { left: 100, right: 40, top: 20, bottom: 45 },
      xAxis: xAxisBase({ type: 'value', name: '特征重要性' }),
      yAxis: yAxisBase({
        type: 'category',
        data: top.map((item) => item.feature),
      }),
      series: [
        {
          type: 'bar',
          data: top.map((item) => item.importance),
          itemStyle: { color: '#406783' },
          label: { show: true, position: 'right' },
        },
      ],
    }
  }, [datasets])

  return (
    <LoadState
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.refresh}
      empty={!resource.loading && !datasets.length}
      emptyText="暂无表格分类实验数据"
    >
      <div className="research-grid">
        {datasets.map((dataset) => (
          <Card
            key={dataset.name}
            title={`${dataset.name} · 混淆矩阵（最佳模型 ${dataset.best_model}）`}
            extra={
              <ChartNote
                desc="最佳模型在实际类别与预测类别上的二分类计数（对角为判对，非对角为判错）。"
                dataSource={`${dataset.name}数据集（${dataset.samples} 样本 · ${dataset.features_dim} 维特征，真实公开数据）。`}
                insight="对角数值越大、非对角越小，说明判别越准。"
              />
            }
          >
            <ThemedChart
              option={confusionOption(dataset)}
              style={{ height: 260 }}
            />
          </Card>
        ))}
        <Card
          title="分类 ROC 曲线对比"
          extra={
            <ChartNote
              desc="各表格分类数据集的 ROC 曲线（真正率 vs 假正率），并叠加随机基线。"
              dataSource="机器故障预测 + 工业制造缺陷预测两个表格分类数据集（真实公开数据）。"
              insight="曲线越贴近左上角、越远离对角线，AUC 越高。"
            />
          }
        >
          {datasets.length ? (
            <ThemedChart option={rocOption} style={{ height: 300 }} />
          ) : (
            <Empty description="数据准备中" />
          )}
        </Card>
        <Card
          title={`特征重要性（${datasets[0]?.name ?? ''}，树模型）`}
          extra={
            datasets[0] ? (
              <ChartNote
                desc="最佳树模型在表格分类任务上的前 15 维特征重要性。"
                dataSource={`${datasets[0].name}数据集（真实公开数据，结构化表格特征）。`}
                insight="重要性越高的特征，对故障/缺陷判别贡献越大。"
              />
            ) : undefined
          }
        >
          {datasets[0]?.feature_importance?.length ? (
            <ThemedChart option={importanceOption} style={{ height: 300 }} />
          ) : (
            <Empty description="数据准备中" />
          )}
        </Card>
        {datasets.map((dataset) => (
          <Card key={`table-${dataset.name}`} title={`${dataset.name} · 模型指标对比`}>
            <Table
              size="small"
              rowKey="name"
              columns={columns}
              dataSource={dataset.models}
              pagination={false}
              scroll={{ x: 540 }}
            />
          </Card>
        ))}
      </div>
    </LoadState>
  )
}

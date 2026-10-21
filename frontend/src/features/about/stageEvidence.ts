import { figureEvidence, finite, type EvidenceMap, type JsonRecord } from './dataContract'
import type { ResearchFigure } from './research'

export interface StagePlot {
  title: string; x: string; y: string; category?: boolean; note: string
  series: Array<{ name: string; type: 'line' | 'bar'; data: Array<[string | number, number]> }>
}
const pairs = (rows: JsonRecord[], x: (r: JsonRecord, i: number) => unknown, y: (r: JsonRecord) => unknown): Array<[string | number, number]> =>
  rows.flatMap((row, i) => { const a = x(row, i), b = y(row); return (typeof a === 'string' || finite(a)) && finite(b) ? [[a, b] as [string | number, number]] : [] })
const bar = (name: string, data: Array<[string | number, number]>) => ({ name, type: 'bar' as const, data })
const line = (name: string, data: Array<[string | number, number]>) => ({ name, type: 'line' as const, data })

/** Explicit per-protocol adapters: never infer arbitrary numeric fields or mix units. */
export function stageEvidence(figure: ResearchFigure, evidence: EvidenceMap): StagePlot | undefined {
  const entry = figureEvidence(figure, evidence)
  if (entry.status !== 'available' || !entry.data) return
  const d = entry.data
  let plot: StagePlot | undefined
  switch (figure) {
    case 'dataset-registry': plot = { title: '登记资产的任务覆盖', x: '任务', y: '数据集数（个）', category: true, note: '数量来自资产登记，不代表各任务的数据量相等。', series: [bar('数据集数', pairs(d.summary?.task_dist ?? [], r => r.task_label, r => r.count))] }; break
    case 'cwru-signal': plot = { title: '同一采样协议下的轴承波形', x: '时间（ms）', y: '振幅（g）', note: `采样率 ${d.overview?.fs ?? '—'} Hz；展示接口提供的波形切片。`, series: (d.time_domain?.waves ?? []).slice(0, 2).map((w: JsonRecord) => line(w.name, pairs((w.wave ?? []).map((v: number, i: number) => ({ t: w.t_ms[i], v })), r => r.t, r => r.v))) }; break
    case 'fpcnn-compare': plot = { title: '噪声条件下的分类对照', x: '信噪比（dB）', y: '准确率（0–1）', category: true, note: '基线与 FP-CNN 采用同一划分和训练轮数；不把满样本精度当作抗噪能力。', series: ['baseline_acc', 'fp_acc'].map((key, i) => bar(i ? 'FP-CNN' : '基线 CNN', pairs(d.noise ?? [], r => String(r.snr_db), r => r[key]))) }; break
    case 'domain-adapt': plot = { title: '构造目标域上的方法对照', x: '实验方法', y: '目标域宏平均准确率', category: true, note: '目标域由物理变换构造；Oracle 使用目标标签，只作上界对照。', series: [bar('目标域准确率', pairs(d.results ?? [], r => r.id, r => r.target_macro_accuracy))] }; break
    case 'rul-sde-pf': plot = { title: '寿命预测误差的同协议比较', x: '方法', y: '归一化剩余寿命 RMSE', category: true, note: 'XJTU-SY 留一法；误差越低越好。完整详情保留负 R²、逐轴承曲线与协议。', series: [bar('RMSE', pairs([{ name: 'SDE + PF', v: d.metrics?.sde_pf?.rmse }, { name: '指数外推', v: d.metrics?.baseline?.rmse }], r => r.name, r => r.v))] }; break
    case 'xjtu-rul': {
      const b = d.bearings?.[0]
      plot = { title: `${b?.id ?? '轴承'} · 全寿命退化`, x: '时间（分钟）', y: '归一化指标（0–1）', note: `${b?.condition ?? '工况未提供'}；舞台展示首根轴承，完整详情可选择全部轴承。`, series: [line('健康指标 HI', pairs(b?.series ?? [], r => r.t, r => r.hi)), line('剩余寿命 RUL', pairs(b?.series ?? [], r => r.t, r => r.rul))] }; break
    }
    case 'digital-twin-phm': plot = { title: '孪生轨迹的失效风险', x: '运行时间（小时）', y: '风险概率（0–1）', note: '数字孪生泵仿真预计算轨迹；不是实体设备实时生产数据。', series: [line('风险概率', pairs(d.degradation?.series ?? [], r => r.t, r => r.prob))] }; break
    case 'smart-factory': plot = { title: '仿真产线的工段差异', x: '工段', y: '故障率（0–1）', category: true, note: 'SmartFactory 仿真数据；完整详情保留样本规模、传感器与机组分布。', series: [bar('故障率', pairs(d.section_health?.items ?? [], r => r.label ?? r.name, r => r.failure_rate))] }; break
    case 'classification': plot = { title: `${d.datasets?.[0]?.name ?? '表格分类'} · 模型对照`, x: '模型', y: 'F1（0–1）', category: true, note: '舞台展示第一个任务；完整详情区分两个数据集，并保留 ROC 与混淆矩阵。', series: [bar('F1', pairs(d.datasets?.[0]?.models ?? [], r => r.name, r => r.f1))] }; break
    case 'steam': plot = { title: '工业蒸汽量 · 回归对照', x: '模型', y: 'R²（可为负）', category: true, note: '按接口返回实际 R²；不截断负值，不与分类精度跨任务排名。', series: [bar('R²', pairs(d.methods ?? [], r => r.name, r => r.r2))] }; break
    case 'vision': plot = { title: 'NEU-DET · 检测精度对照', x: '模型', y: 'mAP50（0–1）', category: true, note: '离线训练产物；不同输入尺寸和推理速度在完整详情中分别标注。', series: [bar('mAP50', pairs(d.models ?? [], r => r.name, r => r.mAP50))] }; break
    // Operational counts must not be repackaged as accuracy; the scene uses a labelled mechanism diagram.
    case 'self-evolution-loop': return
  }
  return plot?.series.some(s => s.data.length) ? plot : undefined
}

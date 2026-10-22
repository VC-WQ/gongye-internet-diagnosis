import type { ResearchFigure } from './research'

export type JsonRecord = Record<string, any>
export type EvidenceStatus = 'loading' | 'available' | 'missing' | 'incomplete' | 'error'
export interface EvidenceEntry {
  status: EvidenceStatus
  data?: JsonRecord
  message?: string
}
export type EvidenceMap = Partial<Record<ResearchFigure | 'steam-analysis', EvidenceEntry>>

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  loading: '读取中', available: '数据已接入', missing: '暂无数据', incomplete: '数据不完整', error: '接口未就绪',
}
const object = (value: unknown): value is JsonRecord => !!value && typeof value === 'object' && !Array.isArray(value)
const rows = (value: unknown): value is JsonRecord[] => Array.isArray(value) && value.length > 0
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const metrics = (value: unknown, keys: string[]) => object(value) && keys.every(key => finite(value[key]))

/** Validate the fields each existing renderer actually consumes; {} must never become a blank chart or 0% result. */
export function inspectEvidence(figure: ResearchFigure | 'steam-analysis', payload: unknown): EvidenceEntry {
  if (!object(payload) || Object.keys(payload).filter(key => key !== '_meta').length === 0) {
    return { status: 'missing', message: '接口未返回该研究的实验产物；保留目录，等待真实数据接入。' }
  }
  let valid = false
  switch (figure) {
    case 'dataset-registry':
      valid = rows(payload.datasets) && payload.datasets.every(d => typeof d.name === 'string' && typeof d.source === 'string' && finite(d.samples))
      break
    case 'cwru-signal':
      valid = metrics(payload.overview, ['n_samples', 'fs']) && rows(payload.time_domain?.waves) && payload.time_domain.waves.every((w: JsonRecord) => rows(w.t_ms) && rows(w.wave) && w.t_ms.length === w.wave.length && w.t_ms.every(finite) && w.wave.every(finite))
        && rows(payload.frequency_domain?.spectra) && payload.frequency_domain.spectra.every((s: JsonRecord) => rows(s.freqs) && rows(s.amp) && s.freqs.length === s.amp.length && s.freqs.every(finite) && s.amp.every(finite))
        && rows(payload.tsne?.points) && rows(payload.tsne?.class_names) && rows(payload.tsne?.labels) && payload.tsne.points.length === payload.tsne.labels.length
        && payload.tsne.points.every((p: unknown[]) => Array.isArray(p) && p.length === 2 && p.every(finite)) && rows(payload.severity_heatmap?.matrix)
      break
    case 'fpcnn-compare':
      valid = metrics(payload.full, ['baseline_acc', 'fp_acc', 'delta']) && rows(payload.few_shot) && rows(payload.noise) && rows(payload.confusion?.baseline) && rows(payload.confusion?.fp_cnn) && object(payload.bands?.learned) && object(payload.config)
      break
    case 'domain-adapt':
      valid = object(payload.target_domains) && Object.keys(payload.target_domains).length > 0 && rows(payload.results) && payload.results.every(r => metrics(r, ['target_macro_accuracy']) && object(r.per_device))
      break
    case 'rul-sde-pf':
      valid = metrics(payload.metrics?.sde_pf, ['rmse', 'mae', 'r2']) && metrics(payload.metrics?.baseline, ['rmse', 'mae', 'r2']) && rows(payload.curves) && payload.curves.every(r => rows(r.actual) && rows(r.sde_pf) && rows(r.baseline))
      break
    case 'xjtu-rul':
      valid = rows(payload.bearings) && payload.bearings.every(b => typeof b.id === 'string' && rows(b.series) && b.series.every((p: JsonRecord) => metrics(p, ['t', 'hi', 'rul'])))
      break
    case 'digital-twin-phm':
      valid = metrics(payload.overview, ['n_trajectories', 'n_steps']) && rows(payload.overview?.failure_type_dist) && rows(payload.degradation?.series) && object(payload.degradation?.events) && rows(payload.ttf_prediction?.points) && metrics(payload.ttf_prediction?.metrics, ['mae_hours', 'rmse_hours', 'corr']) && metrics(payload.maintenance_roi, ['roi', 'avg_maintenance_cost', 'avg_expected_savings', 'avg_downtime_loss', 'avg_cumulative_loss'])
      break
    case 'self-evolution-loop':
      valid = metrics(payload.inner_loop, ['total_events']) && metrics(payload.outer_loop, ['suggestions_total']) && object(payload.metrics)
      break
    case 'smart-factory':
      valid = metrics(payload.overview, ['n_samples', 'n_machines', 'n_sections', 'failure_rate']) && rows(payload.section_health?.items) && rows(payload.sensor_anomaly?.items) && rows(payload.machine_health?.bins) && rows(payload.machine_health?.counts)
      break
    case 'classification':
      valid = rows(payload.datasets) && payload.datasets.every(d => rows(d.models) && d.models.every((m: JsonRecord) => typeof m.name === 'string' && metrics(m, ['accuracy', 'precision', 'recall', 'f1', 'auc'])) && metrics(d.confusion_matrix, ['tn', 'fp', 'fn', 'tp']) && rows(d.roc?.fpr) && rows(d.roc?.tpr) && d.roc.fpr.length === d.roc.tpr.length)
      break
    case 'steam':
      valid = rows(payload.target_true) && rows(payload.methods) && payload.methods.every(m => typeof m.name === 'string' && rows(m.pred) && m.pred.length === payload.target_true.length && metrics(m, ['rmse', 'mae', 'r2']))
      break
    case 'steam-analysis':
      valid = rows(payload.correlation?.names) && rows(payload.correlation?.matrix) && payload.correlation.matrix.length === payload.correlation.names.length && payload.correlation.matrix.every((row: unknown[]) => Array.isArray(row) && row.length === payload.correlation.names.length && row.every(finite))
      break
    case 'vision':
      if (Array.isArray(payload.models) && payload.models.length === 0) return { status: 'missing', data: payload, message: '尚无视觉模型训练对照产物。模型权重可用性与离线指标分别核验。' }
      valid = rows(payload.models) && payload.models.every(m => typeof m.name === 'string' && metrics(m, ['mAP50', 'mAP50_95', 'precision', 'recall', 'fps', 'params_M', 'imgsz']))
      break
  }
  return valid
    ? { status: 'available', data: payload }
    : { status: 'incomplete', data: payload, message: '返回数据缺少当前图表所需字段，暂不绘制，以免把缺失值当作实验结果。' }
}

/** A figure that needs multiple independent sources is only ready when all of them are ready. */
export function figureEvidence(figure: ResearchFigure, evidence: EvidenceMap): EvidenceEntry {
  const primary = evidence[figure] ?? { status: 'loading' as const }
  if (figure !== 'steam' || primary.status !== 'available') return primary
  const correlation = evidence['steam-analysis'] ?? { status: 'loading' as const }
  return correlation.status === 'available' ? primary : { ...correlation, data: primary.data }
}

export interface ComparisonRow {
  key: string
  task: string
  model: string
  source: string
  metrics: Array<{ label: string; value: number; unit?: string }>
}

/** Count model/task observations, never merge metrics from incompatible tasks. */
export function comparisonRows(evidence: EvidenceMap): ComparisonRow[] {
  const result: ComparisonRow[] = []
  if (evidence.classification?.status === 'available') {
    for (const dataset of evidence.classification.data?.datasets ?? []) {
      for (const model of dataset.models) result.push({
        key: `classification:${dataset.name}:${model.name}`, task: dataset.name, model: model.name, source: '公开数据 · 离线分类',
        metrics: ['accuracy', 'precision', 'recall', 'f1', 'auc'].filter(key => finite(model[key])).map(key => ({ label: ({ accuracy: '准确率', precision: '精确率', recall: '召回率', f1: 'F1', auc: 'AUC' } as Record<string, string>)[key], value: model[key] })),
      })
    }
  }
  if (evidence.steam?.status === 'available') {
    for (const method of evidence.steam.data?.methods ?? []) result.push({
      key: `steam:${method.name}`, task: '工业蒸汽量预测', model: method.name, source: '公开数据 · 离线回归',
      metrics: ['r2', 'rmse', 'mae'].filter(key => finite(method[key])).map(key => ({ label: ({ r2: 'R²', rmse: 'RMSE', mae: 'MAE' } as Record<string, string>)[key], value: method[key] })),
    })
  }
  if (evidence.vision?.status === 'available') {
    for (const model of evidence.vision.data?.models ?? []) result.push({
      key: `vision:${model.name}`, task: 'NEU-DET 缺陷检测', model: model.name, source: '公开数据 · 离线检测',
      metrics: [{ label: 'mAP@50', value: model.mAP50 }, { label: 'mAP@50–95', value: model.mAP50_95 }, { label: 'FPS', value: model.fps }, { label: '参数', value: model.params_M, unit: 'M' }],
    })
  }
  return result
}

export function sourceBreakdown(datasets: JsonRecord[]) {
  let simulated = 0, publicData = 0, unknown = 0
  for (const item of datasets) {
    const source = typeof item.source === 'string' ? item.source.trim() : ''
    if (/仿真|合成|simulation|synthetic/i.test(source)) simulated++
    else if (source && /公开|University|大学|交通|NEU|XJTU|CWRU/i.test(source)) publicData++
    else unknown++
  }
  return { simulated, publicData, unknown }
}

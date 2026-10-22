import { finite, type JsonRecord } from './dataContract'

const colors = ['#348875', '#bf5965', '#9a6a25', '#477d9e']
const axis = (name: string, gridIndex = 0) => ({ type: 'value', name, gridIndex, nameLocation: 'middle', nameGap: 29, axisLabel: { fontSize: 12, hideOverlap: true }, splitNumber: 4 })
const line = (name: string, data: unknown[], color: string, grid = 0) => ({ id: name, name, type: 'line', showSymbol: false, connectNulls: false, xAxisIndex: grid, yAxisIndex: grid, data, lineStyle: { width: 2, type: (['solid','dashed','dotted','solid'] as const)[Math.max(0,colors.indexOf(color))], color }, itemStyle: { color } })
const base = { animation: false, tooltip: { trigger: 'axis', confine: true }, legend: { top: 0, type: 'scroll', textStyle: { fontSize: 12 } } }
/** Uses the same published arrays and units as the full CWRU renderer. No synthetic cloud. */
export function signalStage(d: JsonRecord, compact = false) {
  const waves = d.time_domain.waves, spectra = d.frequency_domain.spectra, ts = d.tsne
  const result = { ...base, legend: {...base.legend,data:waves.map((w:JsonRecord)=>w.label)},
    grid: [{ left: '8%', right: '49%', top: '16%', height: '28%' }, { left: '8%', right: '49%', top: '64%', bottom: 40 }, { left: '64%', right: '3%', top: '16%', bottom: 40 }],
    xAxis: [axis('时间（ms）'), axis('频率（Hz）', 1), { ...axis('t-SNE-1', 2), axisLabel: { show: false } }],
    yAxis: [{ ...axis('振幅（g）'), nameLocation: 'end',nameGap:8 }, { ...axis('归一化幅值', 1), nameLocation: 'end',nameGap:8 }, { ...axis('t-SNE-2', 2), axisLabel: { show: false }, nameLocation: 'end' }],
    series: [...waves.map((w: JsonRecord, i: number) => ({...line(w.label, w.t_ms.map((t: number, j: number) => [t, w.wave[j]]), colors[i]),id:`wave-${w.label}`})),
      ...spectra.map((s: JsonRecord, i: number) => ({...line(s.label, s.freqs.map((f: number, j: number) => [f, s.amp[j]]), colors[i], 1),id:`fft-${s.label}`})),
      ...ts.class_names.map((cls: string, i: number) => ({ id: `feature-${cls}`, name: waves[i]?.label??cls, type: 'scatter', xAxisIndex: 2, yAxisIndex: 2, symbolSize: 4,
        data: ts.points.filter((_: unknown, j: number) => ts.labels[j] === cls), symbol: ['circle','rect','triangle','diamond'][i%4], itemStyle: { color: colors[i], opacity: .65 } }))],
  }
  if (compact) {
    result.grid = [{ left: '18%', right: '4%', top: '21%', height: '24%' }, { left: '18%', right: '4%', top: '66%', height: '20%' }]
    result.xAxis = result.xAxis.slice(0, 2); result.yAxis = result.yAxis.slice(0, 2)
    result.series = result.series.filter(s => s.xAxisIndex !== 2)
  }
  return result
}
export function twinStage(d: JsonRecord, compact = false) {
  const s = d.degradation.series, points = d.ttf_prediction.points
  const max = Math.max(...points.flat())
  const events = [['crit_at', '临界'], ['maint_at', '维护'], ['fail_at', '失效']].flatMap(([key, name]) => finite(d.degradation.events[key]) ? [{ xAxis: d.degradation.events[key], name }] : [])
  const result = { ...base, grid: [{ left: '7%', right: '43%', top: 65, bottom: 45 }, { left: '69%', right: '3%', top: 65, bottom: 45 }],
    xAxis: [axis('运行时间（小时）'), { ...axis('实际 TTF（小时）', 1), max }],
    yAxis: [{ ...axis('归一化指标（0–1）'), min: 0, max: 1, nameLocation: 'end' }, { ...axis('预测 TTF（小时）', 1), max, nameLocation: 'end' }],
    series: [
      { ...line('健康风险', s.map((p: JsonRecord) => [p.t, p.hazard]), colors[1]), markLine: { symbol: 'none', label: { formatter: '{b}', fontSize: 12 }, data: events.map((event,i)=>({...event,label:{position: i%2?'insideStartBottom':'insideEndTop',distance:8+i*8}})) } },
      line('故障概率（7天）', s.map((p: JsonRecord) => [p.t, p.prob]), colors[2]), line('振动（归一化）', s.map((p: JsonRecord) => [p.t, p.vib_n]), colors[0]),
      { name: 'TTF 预测样本', type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, symbolSize: 4, data: points, itemStyle: { color: colors[3], opacity: .55 } },
      line('理想线 y=x', [[0, 0], [max, max]], '#87929a', 1)],
  }
  if (compact) {
    result.grid = [{ left: '18%', right: '5%', top: 60, bottom: 45 }]
    result.xAxis = result.xAxis.slice(0, 1); result.yAxis = result.yAxis.slice(0, 1)
    result.series = result.series.filter(s => !('xAxisIndex' in s) || s.xAxisIndex !== 1)
  }
  return result
}
export function domainStage(d: JsonRecord, compact = false) {
  const ids = Object.keys(d.target_domains), results = d.results
  const result = { ...base, tooltip: { trigger: 'item', confine: true },
    grid: [{ left: '20%', right: '48%', top: 55, bottom: 65 }, { left: '67%', right: '3%', top: 55, bottom: 65 }],
    xAxis: [{ type: 'category', data: results.map((r: JsonRecord) => r.id), name: '方法变体', nameLocation: 'middle', nameGap: 27 }, { type: 'category', gridIndex: 1, data: results.map((r: JsonRecord) => r.id) }],
    yAxis: [{ type: 'category', data: ids.map(id => d.target_domains[id].name), axisLabel: { fontSize: 12 } }, { ...axis('准确率（0–1）', 1), min: 0, max: 1, nameLocation: 'end' }],
    visualMap: { seriesIndex: 0, min: 0, max: 1, orient: 'horizontal', left: '20%', bottom: 0, itemWidth: 9, itemHeight: 80, inRange: { color: ['#eee7dd', '#849aa4', '#b6535c'] } },
    series: [{ name: '目标域准确率', type: 'heatmap', data: results.flatMap((r: JsonRecord, x: number) => ids.flatMap((id, y) => finite(r.per_device[id]?.accuracy) ? [[x, y, r.per_device[id].accuracy]] : [])), label: { show: true, fontSize: 12, formatter: (p: {value: number[]}) => p.value[2].toFixed(2) } },
      line('源域准确率', results.map((r: JsonRecord) => r.source_test_accuracy), colors[1], 1), line('目标域宏平均', results.map((r: JsonRecord) => r.target_macro_accuracy), colors[3], 1)],
  }
  if (compact) {
    result.grid = [{ left: '30%', right: '5%', top: 35, bottom: 65 }]
    result.xAxis = result.xAxis.slice(0, 1); result.yAxis = result.yAxis.slice(0, 1)
    Object.assign(result.yAxis[0], { axisLabel: { fontSize: 12, width: 86, overflow: 'truncate' } })
    result.series = result.series.slice(0, 1)
  }
  return result
}

/** A shared geometry is legal only when bearing identity, lengths AND every actual point agree. */
export function sharedLife(xjtu?: JsonRecord, rul?: JsonRecord, id?: string) {
  const bearing = xjtu?.bearings?.find((b: JsonRecord) => b.id === (id ?? xjtu.bearings[0]?.id))
  const curve = rul?.curves?.find((c: JsonRecord) => c.id === bearing?.id)
  if (!bearing || !curve || bearing.series.length !== curve.actual.length || !bearing.series.every((p: JsonRecord, i: number) => finite(p.t) && finite(p.rul) && p.rul === curve.actual[i])) return
  if (!Array.isArray(curve.sde_pf) || !Array.isArray(curve.baseline) || curve.sde_pf.length !== bearing.series.length || curve.baseline.length !== bearing.series.length) return
  const points = bearing.series, end = points[points.length - 1].t
  if (!finite(end) || end <= 0) return
  const path = (values: unknown[]) => {
    let active = false
    return values.map((value, i) => {
      if (!finite(value)) { active = false; return '' }
      const command = active ? 'L' : 'M'; active = true
      return `${command}${(60 + points[i].t / end * 880).toFixed(3)},${(280 - value * 240).toFixed(3)}`
    }).join(' ')
  }
  return { id: bearing.id, end, count: points.length, actual: path(points.map((p: JsonRecord) => p.rul)), hi: path(points.map((p: JsonRecord) => p.hi)), forecast: path(curve.sde_pf), baseline: path(curve.baseline) }
}

/** Same published runs: noise sensitivity and few-shot accuracy, no smoothed invention. */
export function fpCnnStage(d: JsonRecord, compact=false) {
  const curves=(items:JsonRecord[],x:string,grid:number)=>['baseline_acc','fp_acc'].map((key,i)=>({
    ...line(i?'FP-CNN':'基线 1D-CNN',items.map(row=>[row[x],finite(row[key])?row[key]:null]),i?colors[1]:colors[3],grid),
    id:`${grid}-${key}`,showSymbol:true,symbol:i?'diamond':'circle',symbolSize:6,
  }))
  return {...base,
    title:[{text:'a  噪声敏感性',left:compact?'18%':'8%',top:30,textStyle:{fontSize:12,fontWeight:500}},{text:'b  少样本对照',left:compact?'18%':'61%',top:compact?'55%':30,textStyle:{fontSize:12,fontWeight:500}}],
    grid:compact?[{left:'20%',right:'5%',top:63,height:'26%'},{left:'20%',right:'5%',top:'66%',bottom:40}]:[{left:'8%',right:'54%',top:65,bottom:45},{left:'61%',right:'3%',top:65,bottom:45}],
    xAxis:[axis('信噪比 SNR（dB）'),axis('训练数据比例（0–1）',1)],
    yAxis:[{...axis('测试准确率（0–1）'),min:0,max:1,nameLocation:'end'},{...axis('测试准确率（0–1）',1),min:0,max:1,nameLocation:'end'}],
    series:[...curves(d.noise,'snr_db',0),...curves(d.few_shot,'ratio',1)],
  }
}

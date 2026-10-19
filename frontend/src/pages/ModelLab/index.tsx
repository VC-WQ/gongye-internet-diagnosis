import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Collapse, Empty, Row, Select, Space, Spin, Table, Tag } from 'antd'
import ReactECharts from 'echarts-for-react'
import { getClassification, getSteamAnalysis, getSteamMl, getXjtuRul } from '../../services/api'
import ChartNote from '../../components/ChartNote'
import SmartFactory from '../../components/SmartFactory'
import DigitalTwinPhm from '../../components/DigitalTwinPhm'
import { PageHeading, SourceTag } from '../../components/BusinessUI'
import { errorText } from '../../hooks/useResource'
import CwruSignal from '../../components/CwruSignal'
import DataAssetRegistry from '../../components/DataAssetRegistry'
import VisionDetect from '../../components/VisionDetect'
import FPCnnCompare from '../../components/FPCnnCompare'
import RulSdePf from '../../components/RulSdePf'
import DomainAdapt from '../../components/DomainAdapt'
import PicoLab from '../../features/pico/ui/PicoLab'
import { xAxisBase, yAxisBase, AXIS_LABEL_COLOR } from '../../theme/echarts'

const cardBodyStyle = { padding: 12 }

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------
interface ClsModel {
  name: string
  accuracy: number
  precision: number
  recall: number
  f1: number
  auc: number
}

interface ClsDataset {
  name: string
  samples: number
  features_dim: number
  positive_rate: number
  best_model: string
  models: ClsModel[]
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number }
  roc: { fpr: number[]; tpr: number[] }
  feature_importance: Array<{ feature: string; importance: number }>
}

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
  xgboost_available: boolean
}

// XJTU-SY 轴承全寿命退化（健康指标 HI + RUL，作为 RUL 预测的建模依据）
interface XjtuBearing {
  id: string
  condition: string
  lifetime_min: number
  series: Array<{ t: number; rms: number; rms_smooth: number; hi: number; rul: number }>
}

// 蒸汽传感器特征相关性矩阵（38 维）
interface CorrelationMat {
  names: string[]
  matrix: number[][]
}

const STEAM_COLOR: Record<string, string> = {
  线性回归: '#38bdf8',
  岭回归: '#52c41a',
  随机森林: '#fa8c16',
  梯度提升: '#722ed1',
  XGBoost: '#eb2f96',
}

// ---------------------------------------------------------------------------
// 混淆矩阵图表（辅助横评用）
// ---------------------------------------------------------------------------
function confusionOption(ds: ClsDataset) {
  const { tn, fp, fn, tp } = ds.confusion_matrix
  return {
    tooltip: {
      formatter: (p: { data: [number, number, number] }) =>
        `预测${p.data[0] === 0 ? '正常' : '故障'} / 实际${p.data[1] === 0 ? '正常' : '故障'}：${p.data[2]} 例`,
    },
    grid: { left: 60, right: 20, top: 30, bottom: 50 },
    xAxis: xAxisBase({ type: 'category', data: ['正常', '故障'], name: '预测', nameLocation: 'middle', nameGap: 30 }),
    yAxis: yAxisBase({ type: 'category', data: ['故障', '正常'], name: '实际' }),
    visualMap: {
      min: 0,
      max: Math.max(tn, fp, fn, tp),
      show: false,
      inRange: { color: ['#0f2038', '#38bdf8'] },
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
        label: { show: true, fontSize: 16, fontWeight: 700 },
        itemStyle: { borderColor: '#22d3ee', borderWidth: 2 },
      },
    ],
  }
}

/**
 * 算法创新实验验证页面。
 *
 * 定位（解决"主题不突出、内容太杂"的问题）：
 *   本页不是"什么数据集都往里堆"，而是只回答一个问题 ——
 *   **智能会诊页面对三类设备（离心泵 / 电机 / 空压机）做出的诊断结论，凭什么可信？**
 *
 * 因此全页按"主线证据链"组织：
 *   A. 数据底座   ：数据从哪来（6 个真实公开 + 2 个仿真）
 *   B. 创新点一   ：物理频率先验引导 CNN（FP-CNN）—— 故障分类模型怎么更抗噪、更可信
 *   C. 创新点二   ：SDE + 粒子滤波 RUL —— 剩余寿命怎么预测（含建模依据：全寿命退化曲线）
 *   D. 创新点四   ：跨域自适应 —— 实验室模型怎么迁移到现场三类设备
 *   E. 信号层证据 ：CWRU 振动信号从时域→频域→特征空间的诊断链路
 *   F. 视觉分支   ：部件表面缺陷检测（多模态第五路证据）
 *   G. 辅助横评   ：与本系统主线设备无关的通用算法横评，折叠收纳（仅作方法学广度佐证）
 */
export default function ModelLab() {
  const [clsData, setClsData] = useState<ClsDataset[]>([])
  const [steamMl, setSteamMl] = useState<SteamMlData>()
  const [xjtuBearings, setXjtuBearings] = useState<XjtuBearing[]>([])
  const [xjtuId, setXjtuId] = useState<string>()
  const [correlation, setCorrelation] = useState<CorrelationMat>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getClassification()
      .then((d) => {
        if (active) setClsData(d?.datasets ?? [])
      })
      .catch((e) => { if (active) setError(errorText(e)) })
    getSteamMl()
      .then((d) => {
        if (active) setSteamMl(d)
      })
      .catch((e) => { if (active) setError(errorText(e)) })
      .finally(() => {
        if (active) setLoading(false)
      })
    getXjtuRul()
      .then((d) => {
        if (!active) return
        const bs: XjtuBearing[] = d?.bearings ?? []
        setXjtuBearings(bs)
        setXjtuId((prev) => prev ?? bs[0]?.id)
      })
      .catch((e) => { if (active) setError(errorText(e)) })
    getSteamAnalysis()
      .then((d) => {
        if (active) setCorrelation(d?.correlation)
      })
      .catch((e) => { if (active) setError(errorText(e)) })
    return () => {
      active = false
    }
  }, [])

  // ROC 曲线（辅助横评）
  const rocOption = useMemo(() => {
    if (!clsData.length) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 55 },
      xAxis: xAxisBase({ type: 'value', name: '假正率 FPR', min: 0, max: 1, nameLocation: 'middle', nameGap: 30 }),
      yAxis: yAxisBase({ type: 'value', name: '真正率 TPR', min: 0, max: 1 }),
      series: [
        ...clsData.map((ds) => ({
          name: ds.name,
          type: 'line',
          showSymbol: false,
          smooth: true,
          data: ds.roc.fpr.map((v, i) => [v, ds.roc.tpr[i]]),
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
  }, [clsData])

  // 特征重要性（辅助横评，取第一个数据集）
  const importanceOption = useMemo(() => {
    const ds = clsData[0]
    if (!ds?.feature_importance?.length) return {}
    const top = ds.feature_importance.slice(0, 15).reverse()
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 90, right: 40, top: 20, bottom: 45 },
      xAxis: xAxisBase({ type: 'value', name: '特征重要性', nameLocation: 'middle', nameGap: 28 }),
      yAxis: yAxisBase({ type: 'category', data: top.map((e) => e.feature) }),
      series: [
        {
          type: 'bar',
          data: top.map((e) => e.importance),
          itemStyle: { color: '#22d3ee' },
          label: { show: true, position: 'right' },
        },
      ],
    }
  }, [clsData])

  // 蒸汽多模型散点对比（辅助横评）
  const steamScatterOption = useMemo(() => {
    if (!steamMl?.methods?.length) return {}
    const truth = steamMl.target_true
    const maxV = Math.max(...truth)
    const minV = Math.min(...truth)
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 20, top: 36, bottom: 55 },
      xAxis: xAxisBase({ type: 'value', name: '真实值', min: minV, max: maxV, nameLocation: 'middle', nameGap: 30 }),
      yAxis: yAxisBase({ type: 'value', name: '预测值', min: minV, max: maxV }),
      series: [
        ...steamMl.methods.map((m) => ({
          name: m.name,
          type: 'scatter',
          symbolSize: 5,
          data: truth.map((v, i) => [v, m.pred[i]]),
          itemStyle: { color: STEAM_COLOR[m.name] ?? '#94a3b8' },
        })),
        {
          name: '理想线 y=x',
          type: 'line',
          showSymbol: false,
          data: [
            [minV, minV],
            [maxV, maxV],
          ],
          lineStyle: { color: '#94a3b8', type: 'dashed' },
        },
      ],
    }
  }, [steamMl])

  // 蒸汽树模型特征重要性（辅助横评）
  const steamImportanceOption = useMemo(() => {
    if (!steamMl?.feature_importance?.length) return {}
    const top = steamMl.feature_importance.slice(0, 15).reverse()
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 50, right: 40, top: 20, bottom: 45 },
      xAxis: xAxisBase({ type: 'value', name: '特征重要性', nameLocation: 'middle', nameGap: 28 }),
      yAxis: yAxisBase({ type: 'category', data: top.map((e) => e.feature) }),
      series: [
        {
          type: 'bar',
          data: top.map((e) => e.importance),
          itemStyle: { color: '#fa8c16' },
          label: { show: true, position: 'right' },
        },
      ],
    }
  }, [steamMl])

  const xjtuBearing = useMemo(
    () => xjtuBearings.find((b) => b.id === xjtuId),
    [xjtuBearings, xjtuId],
  )

  // XJTU-SY 轴承全寿命退化：健康指标 HI + 剩余寿命 RUL（RUL 预测的建模依据）
  const xjtuHiOption = useMemo(() => {
    if (!xjtuBearing) return {}
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 55, right: 50, top: 36, bottom: 55 },
      xAxis: xAxisBase({ type: 'value', name: '时间(分钟)', nameLocation: 'middle', nameGap: 30 }),
      yAxis: yAxisBase({ type: 'value', name: '指标值 (0–1)', min: 0, max: 1 }),
      series: [
        {
          name: '健康指标 HI',
          type: 'line',
          showSymbol: false,
          smooth: true,
          data: xjtuBearing.series.map((s) => [s.t, s.hi]),
          lineStyle: { color: '#52c41a' },
        },
        {
          name: '剩余寿命 RUL',
          type: 'line',
          showSymbol: false,
          smooth: true,
          data: xjtuBearing.series.map((s) => [s.t, s.rul]),
          lineStyle: { color: '#38bdf8', type: 'dashed' },
        },
      ],
    }
  }, [xjtuBearing])

  // 蒸汽传感器特征相关性热力图（辅助横评）
  const correlationHeatmapOption = useMemo(() => {
    if (!correlation?.matrix?.length) return {}
    const names = correlation.names
    const data: Array<[number, number, number]> = []
    correlation.matrix.forEach((row, i) =>
      row.forEach((v, j) => data.push([j, i, v])),
    )
    return {
      tooltip: { position: 'top' },
      grid: { left: 72, right: 24, top: 24, bottom: 78 },
      xAxis: xAxisBase({
        type: 'category',
        data: names,
        name: '特征',
        nameLocation: 'middle',
        nameGap: 52,
        axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 9, rotate: 90, interval: 0 },
        splitArea: { show: true },
      }),
      yAxis: yAxisBase({
        type: 'category',
        data: names,
        axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 9, interval: 0 },
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
        textStyle: { color: AXIS_LABEL_COLOR },
        inRange: { color: ['#0ea5e9', '#0b1220', '#f5222d'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: false },
          emphasis: { itemStyle: { borderColor: '#64748b', borderWidth: 1 } },
        },
      ],
    }
  }, [correlation])

  const metricColumns = [
    { title: '模型', dataIndex: 'name', key: 'name' },
    { title: '准确率', dataIndex: 'accuracy', key: 'accuracy' },
    { title: '精确率', dataIndex: 'precision', key: 'precision' },
    { title: '召回率', dataIndex: 'recall', key: 'recall' },
    { title: 'F1', dataIndex: 'f1', key: 'f1' },
    { title: 'AUC', dataIndex: 'auc', key: 'auc' },
  ]

  // 统一的章节标题
  const SectionTitle = ({ idx, title, sub }: { idx: string; title: string; sub?: string }) => (
    <div id={`lab-${idx}`} className="lab-section" style={{ margin: '28px 0 12px' }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#22d3ee' }}>
        <span
          style={{
            display: 'inline-block',
            minWidth: 26,
            height: 22,
            lineHeight: '22px',
            textAlign: 'center',
            borderRadius: 4,
            background: 'rgba(34, 211, 238, 0.16)',
            marginRight: 8,
            fontSize: 13,
          }}
        >
          {idx}
        </span>
        {title}
      </div>

    </div>
  )

  return (
    <div className="lab-page"><Spin spinning={loading}>
      <PageHeading title="算法实验室" meta={<SourceTag source="offline_experiment" />} />
      {error && <div role="alert" className="surface" style={{ marginBottom: 20 }}>{error}</div>}
      <nav className="lab-nav" aria-label="实验章节">{[['A','数据资产'],['B','故障分类'],['C','寿命预测'],['D','跨域适应'],['E','信号分析'],['F','视觉检测'],['G','工厂与孪生']].map(([id,label]) => <a key={id} href={`#lab-${id}`}>{label}</a>)}</nav>
      {/* ============ A. 数据底座 ============ */}
      <SectionTitle idx="A" title="数据资产" sub="6 个真实公开数据集（训练与验证算法）+ 2 个仿真数据集（系统主线设备运行数据），逐项标注真实/仿真来源" />
      <DataAssetRegistry />

      {/* ============ B. 创新点一 ============ */}
      <SectionTitle
        idx="B"
        title="故障分类 · FP-CNN"
        sub="把轴承理论特征频率做成可学习频带嵌入网络内部，实现物理知识与深度学习的特征级融合（而非决策层投票拼接）"
      />
      <FPCnnCompare />

      {/* ============ C. 创新点二 ============ */}
      <SectionTitle
        idx="C"
        title="寿命预测 · SDE 与粒子滤波"
        sub="把磨损写成「自加速」随机微分方程状态方程，用粒子滤波在线估计退化速率并做首达时间外推"
      />
      <RulSdePf />

      <div style={{ marginTop: 16 }}>
        <Card
          title="建模依据：轴承全寿命退化曲线（XJTU-SY）"
          styles={{ body: cardBodyStyle }}
          extra={
            <Space size={12}>
              {xjtuBearings.length ? (
                <Select
                  size="small"
                  style={{ width: 170 }}
                  value={xjtuId}
                  onChange={setXjtuId}
                  options={xjtuBearings.map((b) => ({ value: b.id, label: `${b.id}（${b.condition}）` }))}
                />
              ) : null}
              <ChartNote
                desc="单根轴承全寿命的健康指标 HI（单调下降）与剩余寿命 RUL 随时间演化的退化曲线。"
                dataSource="XJTU-SY 西安交大轴承全寿命加速退化数据集（15 根轴承双通道振动 CSV，真实公开数据）。"
                insight="HI 单调下降是寿命预测的建模依据——上面 SDE 状态方程刻画的正是这条曲线的「自加速」段。"
              />
            </Space>
          }
        >
          {xjtuBearing ? (
            <ReactECharts theme="tech-dark" option={xjtuHiOption} style={{ height: 300 }} />
          ) : (
            <Empty description="数据准备中" />
          )}
        </Card>
      </div>

      {/* ============ D. 创新点四 ============ */}
      <SectionTitle
        idx="D"
        title="跨域适应"
        sub="证明「实验室训练的模型能否直接用在本系统三类设备上」，并用无目标域标签的自适应方法把域漂移补回来"
      />
      <DomainAdapt />

      {/* ============ E. 信号层证据 ============ */}
      <SectionTitle
        idx="E"
        title="信号分析"
        sub="时域 → 频域 → 特征空间的完整诊断链路（CWRU 真实公开数据）"
      />
      <CwruSignal />

      {/* ============ F. 视觉分支 ============ */}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid #1e293b' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#22d3ee' }}>
          <span
            style={{
              display: 'inline-block',
              minWidth: 26,
              height: 22,
              lineHeight: '22px',
              textAlign: 'center',
              borderRadius: 4,
              background: 'rgba(34, 211, 238, 0.16)',
              marginRight: 8,
              fontSize: 13,
            }}
          >
            F
          </span>
          视觉分支 · 关键部件表面缺陷检测（多模态第五路证据）
        </div>
        <div style={{ fontSize: 12, color: '#78879b', marginTop: 4, marginBottom: 12 }}>
          振动诊断看设备"动态响应"，视觉检测看部件"表面形貌"，二者判的是同一类失效的两种表现；
          检测结果作为第五路证据进入会诊的 D-S 融合（见智能会诊页面上传入口）。
        </div>
      </div>
      <SectionTitle idx="F" title="部件表面视觉检测" />
      <VisionDetect />

      {/* ============ G. 辅助横评（折叠收纳，非主线设备） ============ */}
      <div style={{ marginTop: 40 }}>
        <Collapse
          items={[
            {
              key: 'aux',
              label: (
                <span style={{ color: '#94a3b8' }}>
                  <strong style={{ color: '#e2e8f0' }}>G · 辅助材料：通用算法横评</strong>
                  <span style={{ fontSize: 12, marginLeft: 10 }}>
                    （工业蒸汽量回归 / 机器故障与制造缺陷表格分类 —— 用于佐证方法学广度，
                    <strong style={{ color: '#faad14' }}>与本系统三类主线设备无直接关系，故折叠收纳</strong>）
                  </span>
                </span>
              ),
              children: (
                <Row gutter={16}>
                  {/* 蒸汽 sklearn 多模型 */}
                  <Col xs={24} lg={14}>
                    <Card
                      title="蒸汽量预测 · sklearn/XGBoost 多模型对比"
                      styles={{ body: cardBodyStyle }}
                      extra={
                        <ChartNote
                          desc="线性回归 / 岭回归 / 随机森林 / 梯度提升 / XGBoost 五模型在蒸汽量预测上的「真实值 vs 预测值」散点，叠加 y=x 理想线。"
                          dataSource="工业蒸汽量预测数据集（2888 样本 · 38 维特征 + 1 目标，真实公开数据）。"
                          insight="散点越贴近 y=x 理想线，模型回归越准（R² 越接近 1）。"
                        />
                      }
                    >
                      {steamMl ? (
                        <ReactECharts theme="tech-dark" option={steamScatterOption} style={{ height: 300 }} />
                      ) : (
                        <Empty description="数据准备中" />
                      )}
                    </Card>
                  </Col>

                  <Col xs={24} lg={10}>
                    <Card
                      title="蒸汽量 · 树模型特征重要性（随机森林）"
                      styles={{ body: cardBodyStyle }}
                      extra={
                        <ChartNote
                          desc="随机森林模型在蒸汽量回归任务上的特征重要性排序（取前 15 维）。"
                          dataSource="工业蒸汽量预测数据集（38 维传感器特征，真实公开数据）。"
                          insight="重要性越高的传感器特征，对蒸汽量预测的贡献越大。"
                        />
                      }
                    >
                      {steamMl ? (
                        <ReactECharts theme="tech-dark" option={steamImportanceOption} style={{ height: 300 }} />
                      ) : (
                        <Empty description="数据准备中" />
                      )}
                    </Card>
                  </Col>

                  <Col span={24} style={{ marginTop: 16 }}>
                    <Card title="蒸汽量回归 · 模型指标对比" styles={{ body: cardBodyStyle }}>
                      <Table
                        size="small"
                        rowKey="name"
                        pagination={false}
                        columns={[
                          { title: '模型', dataIndex: 'name', key: 'name' },
                          { title: 'R²', dataIndex: 'r2', key: 'r2' },
                          { title: 'RMSE', dataIndex: 'rmse', key: 'rmse' },
                          { title: 'MAE', dataIndex: 'mae', key: 'mae' },
                        ]}
                        dataSource={steamMl?.methods ?? []}
                      />
                    </Card>
                  </Col>

                  {/* 表格分类：混淆矩阵 */}
                  {clsData.map((ds) => (
                    <Col xs={24} lg={12} key={ds.name} style={{ marginTop: 16 }}>
                      <Card
                        title={`${ds.name} · 混淆矩阵（最佳模型 ${ds.best_model}）`}
                        styles={{ body: cardBodyStyle }}
                        extra={
                          <Space size={12}>
                            <Tag color="blue">{ds.samples} 样本</Tag>
                            <ChartNote
                              desc={`${ds.best_model} 在「${ds.name}」上的混淆矩阵，展示实际类别 vs 预测类别的二分类计数（对角=判对，非对角=判错）。`}
                              dataSource={`${ds.name}数据集（${ds.samples} 样本 · ${ds.features_dim} 维特征 · 真实公开数据集）。`}
                              insight="对角线数值越大（TP/TN 多）、非对角越小（FP/FN 少），说明模型判别越准。"
                            />
                          </Space>
                        }
                      >
                        {ds.confusion_matrix.tp + ds.confusion_matrix.tn + ds.confusion_matrix.fp + ds.confusion_matrix.fn > 0 ? (
                          <ReactECharts theme="tech-dark" option={confusionOption(ds)} style={{ height: 260 }} />
                        ) : (
                          <Empty description="数据准备中" />
                        )}
                      </Card>
                    </Col>
                  ))}

                  <Col xs={24} lg={12} style={{ marginTop: 16 }}>
                    <Card
                      title="分类 ROC 曲线对比"
                      styles={{ body: cardBodyStyle }}
                      extra={
                        <ChartNote
                          desc="两个表格分类数据集各自的 ROC 曲线（真正率 vs 假正率），并叠加随机基线（对角线）。"
                          dataSource="机器故障预测 + 工业制造缺陷预测两个表格分类数据集（真实公开数据集）。"
                          insight="曲线越贴近左上角、越远离对角线，AUC 越高、二分类判别能力越强。"
                        />
                      }
                    >
                      {clsData.length ? (
                        <ReactECharts theme="tech-dark" option={rocOption} style={{ height: 300 }} />
                      ) : (
                        <Empty description="数据准备中" />
                      )}
                    </Card>
                  </Col>

                  <Col xs={24} lg={12} style={{ marginTop: 16 }}>
                    <Card
                      title={`特征重要性（${clsData[0]?.name ?? ''}，树模型）`}
                      styles={{ body: cardBodyStyle }}
                      extra={
                        <ChartNote
                          desc={`最佳树模型在「${clsData[0]?.name ?? ''}」任务上的特征重要性排序（取前 15 维）。`}
                          dataSource={`${clsData[0]?.name ?? ''}数据集（真实公开数据集，结构化表格特征）。`}
                          insight="重要性越高的特征，对该任务故障/缺陷判别的贡献越大。"
                        />
                      }
                    >
                      {clsData[0]?.feature_importance?.length ? (
                        <ReactECharts theme="tech-dark" option={importanceOption} style={{ height: 300 }} />
                      ) : (
                        <Empty description="数据准备中" />
                      )}
                    </Card>
                  </Col>

                  {clsData.map((ds) => (
                    <Col xs={24} lg={12} key={`tbl-${ds.name}`} style={{ marginTop: 16 }}>
                      <Card title={`${ds.name} · 模型指标对比`} styles={{ body: cardBodyStyle }}>
                        <Table
                          size="small"
                          rowKey="name"
                          columns={metricColumns}
                          dataSource={ds.models}
                          pagination={false}
                        />
                      </Card>
                    </Col>
                  ))}

                  {/* 蒸汽相关性热力图 */}
                  <Col span={24} style={{ marginTop: 16 }}>
                    <Card
                      title="蒸汽传感器特征相关性热力图（38 维）"
                      styles={{ body: cardBodyStyle }}
                      extra={
                        <ChartNote
                          desc="38 维蒸汽传感器特征两两之间的线性相关系数热力图（红=正相关，蓝=负相关，深色=弱相关）。"
                          dataSource="工业蒸汽量预测数据集（38 维传感器特征 V0~V37，真实公开数据）。"
                          insight="识别高度相关的冗余特征，可为特征工程（降维/去冗余）提供依据。"
                        />
                      }
                    >
                      {correlation ? (
                        <ReactECharts theme="tech-dark" option={correlationHeatmapOption} style={{ height: 380 }} />
                      ) : (
                        <Empty description="数据准备中" />
                      )}
                    </Card>
                  </Col>
                </Row>
              ),
            },
          ]}
        />
      </div>
      <SectionTitle idx="G" title="工厂数据与预测性维护" />
      <SmartFactory />
      <DigitalTwinPhm />
      {import.meta.env.DEV && <PicoLab />}
    </Spin></div>
  )
}

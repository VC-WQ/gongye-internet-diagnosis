/** 研究域的真实目录：目录声明与当前可用证据分别统计。 */
export type ResearchFigure =
  | 'dataset-registry'
  | 'cwru-signal'
  | 'fpcnn-compare'
  | 'domain-adapt'
  | 'rul-sde-pf'
  | 'digital-twin-phm'
  | 'self-evolution-loop'
  | 'smart-factory'
  | 'xjtu-rul'
  | 'classification'
  | 'steam'
  | 'vision'

export interface ResearchPoint {
  id: string
  title: string
  summary: string
  api: string
  figure?: ResearchFigure
}

export interface ResearchTopic {
  id: string
  index: string
  title: string
  summary: string
  points: ResearchPoint[]
}

export const RESEARCH_TOPICS: ResearchTopic[] = [
  {
    id: 'signal',
    index: '01',
    title: '数据与信号',
    summary: '数据资产口径、轴承振动信号与诊断特征的真实来源。',
    points: [
      {
        id: 'assets',
        title: '数据资产登记',
        summary:
          '登记公开数据集、仿真数据与实验产物的来源、规模与用途，区分训练、验证和现场数据。',
        api: '/api/v1/viz/dataset-registry',
        figure: 'dataset-registry',
      },
      {
        id: 'cwru',
        title: 'CWRU 轴承信号',
        summary:
          'CWRU 轴承振动信号的时域波形、频谱与包络特征，是故障分类与特征工程的原始证据。',
        api: '/api/v1/viz/cwru-signal',
        figure: 'cwru-signal',
      },
    ],
  },
  {
    id: 'diagnosis',
    index: '02',
    title: '诊断与识别',
    summary: '从物理先验引导的分类模型，到跨域迁移的现场适配。',
    points: [
      {
        id: 'fpcnn',
        title: 'FP-CNN 分类对照',
        summary:
          '将轴承故障特征频率作为物理先验引入卷积网络，并与基线模型在同一数据划分上对照。',
        api: '/api/v1/viz/fp-cnn-compare',
        figure: 'fpcnn-compare',
      },
      {
        id: 'domain',
        title: '跨域自适应',
        summary:
          '比较实验室数据与物理变换构造目标域之间的分布差异，验证特征迁移与域自适应的实际效果。',
        api: '/api/v1/viz/domain-adapt',
        figure: 'domain-adapt',
      },
    ],
  },
  {
    id: 'health',
    index: '03',
    title: '健康与寿命',
    summary: '退化状态估计、剩余寿命预测与泵类设备的预测性维护。',
    points: [
      {
        id: 'rul',
        title: 'SDE + 粒子滤波 RUL',
        summary:
          '以随机微分方程描述退化过程，用粒子滤波在线更新状态并给出剩余寿命分布。',
        api: '/api/v1/viz/rul-sde-pf',
        figure: 'rul-sde-pf',
      },
      {
        id: 'xjtu',
        title: '全寿命退化曲线',
        summary:
          'XJTU-SY 轴承全寿命健康指标与剩余寿命曲线，是 SDE + 粒子滤波寿命预测的建模依据。',
        api: '/api/v1/viz/xjtu-rul',
        figure: 'xjtu-rul',
      },
      {
        id: 'twin',
        title: '数字孪生 PHM',
        summary:
          '泵类设备的孪生隐状态、退化轨迹与预测性维护结果，来自后端预计算的仿真数据实验产物，不是实时设备采集。',
        api: '/api/v1/viz/pump-phm',
        figure: 'digital-twin-phm',
      },
    ],
  },
  {
    id: 'mechanism',
    index: '04',
    title: '系统机理',
    summary: '多智能体会诊、事件闭环与阈值自进化如何组织成可运行的诊断系统。',
    points: [
      {
        id: 'loop',
        title: '双闭环自进化',
        summary:
          '内闭环在事件级触发再诊断，外闭环根据历史误报与漏报复盘阈值建议；统计来自真实诊断记录。',
        api: '/api/v1/self-eval/loops',
        figure: 'self-evolution-loop',
      },
      {
        id: 'factory',
        title: '工厂运行组织',
        summary:
          '设备异构性、工况与事件在工厂层面的组织关系，用于解释场景与诊断上下文为何必须共享同一设备身份。',
        api: '/api/v1/viz/smartfactory',
        figure: 'smart-factory',
      },
    ],
  },
  {
    id: 'results',
    index: '05',
    title: '实验与成果',
    summary: '按证据类型索引本仓库可复核的实验结果、方法与数据。',
    points: [
      {
        id: 'evidence',
        title: '证据索引',
        summary:
          '按真实可用状态列出研究实验；每项都可回到对应图表与数据资产登记核对，缺失产物会明确标记，不在前端生成未经验证的数值。',
        api: '/api/v1/viz/dataset-registry',
      },
      {
        id: 'classification',
        title: '表格分类横评',
        summary:
          '机器故障预测与工业制造缺陷预测两个表格分类数据集上的混淆矩阵、ROC 与特征重要性。',
        api: '/api/v1/viz/classification',
        figure: 'classification',
      },
      {
        id: 'steam',
        title: '蒸汽量回归横评',
        summary:
          '工业蒸汽量预测数据集上的多模型回归对照、特征重要性与传感器相关性热力图。',
        api: '/api/v1/viz/steam-ml',
        figure: 'steam',
      },
      {
        id: 'vision',
        title: '视觉模型对照',
        summary:
          'YOLOv8s 与 RT-DETR 在 NEU-DET 缺陷检测上的精度、速度与参数量对照；实操入口在工具区。',
        api: '/api/v1/vision/comparison',
        figure: 'vision',
      },
    ],
  },
]

export function findTopic(topicId?: string): ResearchTopic | undefined {
  return RESEARCH_TOPICS.find((topic) => topic.id === topicId)
}

export function findPoint(
  topic: ResearchTopic | undefined,
  pointId?: string,
): ResearchPoint | undefined {
  return topic?.points.find((point) => point.id === pointId)
}


export interface ResearchProvenance {
  source: string
  method: string
  evidence: string
  kind: 'public' | 'simulation' | 'mixed' | 'runtime'
}

/** Audited provenance of the existing dataset/experiment protocols, not a claim about live availability. */
export const PROVENANCE: Record<ResearchFigure, ResearchProvenance> = {
  'dataset-registry': { source: '公开数据 + 仿真数据登记', method: '资产清单与任务覆盖', evidence: '数据资产', kind: 'mixed' },
  'cwru-signal': { source: 'CWRU 公开轴承数据', method: '时域 / 频谱 / t-SNE', evidence: '离线信号分析', kind: 'public' },
  'fpcnn-compare': { source: 'CWRU 公开轴承数据', method: 'FP-CNN / 基线 CNN', evidence: '分类对照实验', kind: 'public' },
  'domain-adapt': { source: 'CWRU 源域 + 物理变换目标域', method: 'CORAL / DANN / 上界对照', evidence: '构造目标域实验', kind: 'mixed' },
  'rul-sde-pf': { source: 'XJTU-SY 公开全寿命数据', method: 'SDE + PF / 指数外推', evidence: '留一法寿命对照', kind: 'public' },
  'xjtu-rul': { source: 'XJTU-SY 公开全寿命数据', method: 'HI / RUL 退化轨迹', evidence: '离线退化曲线', kind: 'public' },
  'digital-twin-phm': { source: '数字孪生泵仿真数据', method: '风险轨迹 / TTF / 维护价值', evidence: '仿真 PHM 实验', kind: 'simulation' },
  'self-evolution-loop': { source: '当前数据库近 30 天统计', method: '事件闭环 / 人工阈值采纳', evidence: '机制说明 + 运行统计', kind: 'runtime' },
  'smart-factory': { source: 'SmartFactory 产线仿真数据', method: '工段 / 传感器 / 机组分布', evidence: '仿真产线分析', kind: 'simulation' },
  classification: { source: '机器故障 / 制造缺陷公开数据', method: '多模型分类 / ROC / 重要性', evidence: '离线分类横评', kind: 'public' },
  steam: { source: '工业蒸汽量公开数据', method: '多模型回归 / 相关性', evidence: '离线回归横评', kind: 'public' },
  vision: { source: 'NEU-DET 公开缺陷图像', method: 'YOLOv8s / RT-DETR', evidence: '离线训练产物对照', kind: 'public' },
}

import { Table } from 'antd'
import { comparisonRows, figureEvidence, finite, sourceBreakdown, type EvidenceMap, type JsonRecord } from './dataContract'
import { PROVENANCE, RESEARCH_TOPICS } from './research'
import { EvidenceBadge } from './ResearchOverview'
import ResearchLink from './ResearchLink'
import { pointAnchor, topicAnchor } from './researchNavigation'

const n = (value: unknown) => finite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '—'
export default function ResearchEvidenceIndex({ evidence, includeRuntime }: { evidence: EvidenceMap; includeRuntime: boolean }) {
  const datasets: JsonRecord[] = evidence['dataset-registry']?.status === 'available' ? evidence['dataset-registry'].data?.datasets ?? [] : []
  const sources = sourceBreakdown(datasets)
  const models = comparisonRows(evidence)
  const coverage = RESEARCH_TOPICS.map(topic => {
    const declared = topic.points.flatMap(point => point.figure ? [point.figure] : [])
    return { key: topic.id, topic, declared, available: declared.filter(figure => figureEvidence(figure, evidence).status === 'available').length }
  })
  return <div className="research-evidence-index">
    <p className="research-section__note">目录声明与本次实际可用证据分列。公开数据、构造目标域、仿真与数据库运行统计使用各自口径；缺失产物保留说明，不在前端生成数值。</p>
    <div className="research-evidence-grid">{RESEARCH_TOPICS.flatMap(topic => topic.points.filter(point => point.figure).map(point => <ResearchLink key={`${topic.id}/${point.id}`} anchor={pointAnchor(topic.id, point.id)}><strong>{point.title}</strong>{!includeRuntime && point.figure === 'self-evolution-loop' ? <span className="research-evidence-status">登录后查看统计</span> : <EvidenceBadge status={figureEvidence(point.figure!, evidence).status} />}<small>{PROVENANCE[point.figure!].source}</small></ResearchLink>))}</div>
    <h4>研究内容与数据状态</h4>
    <Table size="small" pagination={false} rowKey="key" dataSource={coverage} scroll={{ x: 760 }} columns={[
      { title: '研究方向 / 核心问题', key: 'topic', width: 230, render: (_, row) => <ResearchLink className="research-table-link" anchor={topicAnchor(row.topic.id)}><strong>{row.topic.index} · {row.topic.title}</strong><small>{row.topic.summary}</small></ResearchLink> },
      { title: '数据来源与方法', key: 'sources', width: 340, render: (_, row) => <div className="research-cell-lines">{row.declared.map(figure => <span key={figure}>{PROVENANCE[figure].source} · {PROVENANCE[figure].method}</span>)}</div> },
      { title: '实际可用', key: 'state', width: 110, render: (_, row) => <span>{row.available} / {row.declared.length}<small className="research-cell-note">{row.topic.id === 'mechanism' && !includeRuntime ? '运行统计未请求' : '按接口结构核验'}</small></span> },
    ]} />
    <h4>数据资产与实验基础</h4>
    <p className="research-section__note">{datasets.length ? `登记 ${datasets.length} 个数据集：公开数据 ${sources.publicData} 个、仿真数据 ${sources.simulated} 个${sources.unknown ? `、来源未归类 ${sources.unknown} 个` : ''}。样本口径包含信号切片、图像和时序记录，不能相加作为独立实测设备数量。` : '资产接口尚未返回有效登记数据，不推定数据集数量或样本量。'}</p>
    <Table size="small" pagination={false} rowKey="name" dataSource={datasets} scroll={{ x: 800 }} locale={{ emptyText: evidence['dataset-registry']?.message ?? '资产登记核验中' }} columns={[
      { title: '数据集', dataIndex: 'name', width: 160 }, { title: '样本量', dataIndex: 'samples', width: 100, render: n },
      { title: '维度 / 数据类型', key: 'dim', width: 220, render: (_, row) => <span>{row.dim ?? '维度未提供'}<small className="research-cell-note">{row.modality ?? '类型未提供'}</small></span> },
      { title: '来源', dataIndex: 'source', width: 200 }, { title: '用途', dataIndex: 'used_in', width: 220 },
    ]} />
    <h4>模型与算法对照</h4>
    <p className="research-section__note">分类评分、回归误差、检测速度采用各自口径，不跨任务统一排名。</p>
    <Table size="small" pagination={{ pageSize: 8, showSizeChanger: false }} rowKey="key" dataSource={models} scroll={{ x: 790 }} locale={{ emptyText: '当前没有通过结构核验的横评结果' }} columns={[
      { title: '实验任务', dataIndex: 'task', width: 180 }, { title: '模型', dataIndex: 'model', width: 140 },
      { title: '实际指标', key: 'metrics', width: 360, render: (_, row) => <div className="research-model-metrics">{row.metrics.map(metric => <span key={metric.label}><small>{metric.label}</small><b>{n(metric.value)}{metric.unit ?? ''}</b></span>)}</div> },
      { title: '口径', dataIndex: 'source', width: 160 },
    ]} />
  </div>
}

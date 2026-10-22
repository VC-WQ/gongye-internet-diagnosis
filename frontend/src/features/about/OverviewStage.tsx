import { RESEARCH_TOPICS, PROVENANCE } from './research'
import type { EvidenceMap } from './dataContract'

/** Catalogue relationships and registered assets, never a second CWRU chart. */
export default function OverviewStage({ evidence }: { evidence: EvidenceMap }) {
  const registry=evidence['dataset-registry']
  const datasets=registry?.status==='available'?registry.data?.datasets:undefined
  return <figure className="stage-overview" aria-label="研究目录与数据来源关系图" data-research-overview-map>
    <figcaption><strong>{RESEARCH_TOPICS.length} 个研究方向</strong><span>{RESEARCH_TOPICS.reduce((n,t)=>n+t.points.length,0)} 项研究内容 · 按任务浏览方法与实验</span></figcaption>
    <div className="stage-overview__branches">
      {RESEARCH_TOPICS.map(topic=><section key={topic.id} className="stage-overview__branch">
        <span className="stage-overview__index">{topic.index}</span><h3>{topic.title}</h3>
        <ul>{topic.points.map(point=><li key={point.id}><strong title={point.figure?PROVENANCE[point.figure].source:undefined}>{point.title}</strong><small>{point.figure?PROVENANCE[point.figure].source:'机制说明与研究索引'}</small></li>)}</ul>
      </section>)}
    </div>
    <p className="stage-overview__assets">{datasets ? <>已登记 {datasets.length} 个数据集：{datasets.map((d:{name:string})=>d.name).join(' · ')}。</> : registry?.status==='loading'||!registry ? '正在加载数据集目录…' : registry.message} 公开数据、构造目标域、仿真与运行统计分别标注；各项结果在对应章节查看。</p>
  </figure>
}

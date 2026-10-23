import { Alert, Collapse, Tag } from 'antd'
import FlipText from '../motion/FlipText'
import FlipValue from '../motion/FlipValue'
import type {
  ConsultResult,
  DiagnosisReport,
  EventSummary,
} from '../services/api'
import { numberText, SourceTag, StatusTag } from './BusinessUI'

export default function DiagnosisSummary({
  event,
  showAgents = true,
}: {
  event: EventSummary
  showAgents?: boolean
}) {
  const diag: ConsultResult | undefined = event.agent_diagnosis
  const report: DiagnosisReport = event.report ?? diag?.report ?? {}
  const agents = diag?.agent_results ?? []
  const degraded = agents.some((agent) =>
    /model_unavailable|heuristic|insufficient/.test(
      JSON.stringify(agent.details),
    ),
  )
  const fields: Array<{ key: keyof DiagnosisReport; title: string }> = [
    { key: 'physical_evidence', title: '物理证据' },
    { key: 'signal_evidence', title: '信号证据' },
    { key: 'knowledge_basis', title: '知识依据' },
    { key: 'impact', title: '影响评估' },
  ]
  const visual = report.vision_evidence
  return (
    <>
      <div className="diagnosis-result">
        <div className="chart-source">
          <span>
            事件 #{event.id} · {event.device_id}
          </span>
          <StatusTag status={event.status_state} event />
        </div>
        <h2><FlipText value={diag?.fault_label ?? event.fault_type ?? '诊断结果'} /></h2>
        <p>{report.summary ?? '暂无诊断摘要'}</p>
        <div className="page-meta">
          <span>
            置信度{' '}
            <FlipValue value={typeof event.confidence === 'number'
              ? `${(event.confidence * 100).toFixed(1)}%`
              : '—'} />
          </span>
          <span>健康评分 <FlipValue value={numberText(event.health_score)} /></span>
          <SourceTag source="history" />
        </div>
      </div>
      {degraded && (
        <Alert
          showIcon
          type="warning"
          message="部分模型或证据不足，请人工复核"
        />
      )}
      {diag?.conflict_detected && (
        <Alert showIcon type="warning" message="分析证据存在分歧" />
      )}
      {report.recommendation && (
        <div className="evidence-block">
          <h3>维护建议</h3>
          <p>{String(report.recommendation)}</p>
        </div>
      )}
      <div className="evidence-grid">
        {fields.map(({ key, title }) =>
          report[key] ? (
            <div className="evidence-block" key={key}>
              <h3>{title}</h3>
              <p>{String(report[key])}</p>
            </div>
          ) : null,
        )}
        {visual ? (
          <div className="evidence-block">
            <h3>视觉证据</h3>
            <p>
              {typeof visual === 'object'
                ? String(
                    (visual as { text?: unknown }).text ?? '已接入视觉证据',
                  )
                : String(visual)}
            </p>
          </div>
        ) : null}
      </div>
      {Array.isArray(report.follow_up_questions) &&
        report.follow_up_questions.length > 0 && (
          <Collapse
            ghost
            items={[
              {
                key: 'questions',
                label: '待核实事项',
                children: (
                  <ul>
                    {report.follow_up_questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        )}
      {showAgents && agents.length > 0 && (
        <Collapse
          ghost
          items={[
            {
              key: 'agents',
              label: `分析证据 · ${agents.length} 个智能体`,
              children: agents.map((agent, i) => (
                <article className="agent-row" key={`${agent.agent_role}-${i}`}>
                  <div className="agent-heading">
                    <strong>{agent.agent_name}</strong>
                    <Tag>
                      {typeof agent.confidence === 'number'
                        ? `${(agent.confidence * 100).toFixed(1)}%`
                        : '—'}
                    </Tag>
                  </div>
                  <p>{agent.conclusion}</p>
                  <div className="agent-evidence">{agent.evidence}</div>
                  <Collapse
                    size="small"
                    ghost
                    items={[
                      {
                        key: 'detail',
                        label: '技术明细',
                        children: (
                          <pre>{JSON.stringify(agent.details, null, 2)}</pre>
                        ),
                      },
                    ]}
                  />
                </article>
              )),
            },
          ]}
        />
      )}
    </>
  )
}

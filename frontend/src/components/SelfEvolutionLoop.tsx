import { LoadState } from './BusinessUI'
import { errorText } from '../hooks/useResource'
import { useEffect, useState } from 'react'
import { Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag } from 'antd'
import { getSelfEvalLoops } from '../services/api'
import ChartNote from './ChartNote'

const cardBodyStyle = { padding: 12 }

interface LoopData {
  days: number
  inner_loop: {
    total_events: number
    by_state: Record<string, string | number>
    feedback_verdict: { recovered: number; relapsed: number; extend: number }
    auto_reconsult_count: number
    auto_suggestion_trigger_count: number
    note: string
  }
  outer_loop: {
    suggestions_total: number
    accepted: number
    rejected: number
    pending: number
    adoption_rate: number
    devices_involved: number
    note: string
  }
  metrics: {
    total: number
    accuracy: number
    false_alarm_rate: number
    miss_rate: number
    avg_latency_seconds: number
    threshold_calibration_count: number
  }
}

const STATE_LABEL: Record<string, string> = {
  normal: '正常',
  warning: '预警',
  alarm: '告警',
  consulting: '会诊中',
  pending: '待确认',
  handling: '处置中',
  observing: '观察期',
  recovered: '已恢复',
  relapsed: '复发',
  unknown: '未知',
}

// 内闭环链路节点（按顺序）：异常 → 会诊 → 人工确认 → 处置 → 观察 → 评估 → 回流
const INNER_NODES = [
  { t: '异常检测', d: '阈值+残差判定告警', c: '#bf5965' },
  { t: '多智能体会诊', d: '5 路证据 D-S 融合', c: '#9a6a25' },
  { t: '人工确认/修订', d: '确认·修改·拒绝', c: '#9a752d' },
  { t: '下发指令', d: '进入处置中', c: '#477d9e' },
  { t: '观察期评估', d: '恢复曲线偏差判定', c: '#477d9e' },
  { t: '自动回流', d: '恢复记准确率 / 复发自动再诊断', c: '#348875' },
]

// 外闭环链路节点：反馈累积 → 阈值建议 → 人工采纳 → 阈值生效 → 影响下一轮检测
const OUTER_NODES = [
  { t: '反馈累积', d: '准确率/误报/漏报', c: '#76689a' },
  { t: '阈值建议生成', d: '复发事件自动触发', c: '#a86382' },
  { t: '人工采纳/拒绝', d: '工程师决策留痕', c: '#9a6a25' },
  { t: '动态阈值生效', d: '写入设备判定边界', c: '#477d9e' },
  { t: '反哺下一轮检测', d: '改变异常判定结果', c: '#348875' },
]

function NodeChain({ nodes }: { nodes: Array<{ t: string; d: string; c: string }> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', gap: 6 }}>
      {nodes.map((n, i) => (
        <div key={n.t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              minWidth: 108,
              padding: '8px 10px',
              borderRadius: 0,
              background: "var(--surface-muted)",
              border: `1px solid ${n.c}55`,
              borderLeft: `3px solid ${n.c}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{n.t}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{n.d}</div>
          </div>
          {i < nodes.length - 1 && <span style={{ color: "var(--muted)", fontSize: 16 }}>→</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * 创新点五：双闭环自进化。
 *
 * 内闭环（事件级，分钟级，无需人工介入）：
 *     异常 → 会诊 → 处置 → 观察期恢复曲线评估 → 恢复则记入准确率；
 *     复发则**自动再诊断**并**自动生成阈值建议**。
 * 外闭环（系统级，天/周级，人工把关）：
 *     阈值建议 → 人工采纳/拒绝 → 动态阈值生效 → 反哺下一轮异常检测，
 *     同时人工反馈累积为采纳率、准确率、误报率、漏报率。
 *
 * 关键点：内闭环让系统"自己发现问题"，外闭环让"人的判断沉淀成系统能力"。
 */
export default function SelfEvolutionLoop() {
  const [data, setData] = useState<LoopData>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    getSelfEvalLoops()
      .then((d) => {
        if (active) setData(d)
      })
      .catch((e) => { if (active) setLoadError(errorText(e)) })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const inner = data?.inner_loop
  const outer = data?.outer_loop
  const m = data?.metrics

  return (
    <LoadState loading={loading} error={loadError} onRetry={() => window.location.reload()}><Spin spinning={false}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 12 }}>
          <Space size={8} wrap>

            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              事件反馈与阈值调整
            </span>
          </Space>
        </Col>

        {/* ---------- 内闭环 ---------- */}
        <Col span={24} style={{ marginBottom: 16 }}>
          <Card
            title="内闭环 · 事件级在线闭环（分钟级，无需人工介入）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="单个事件从告警到回流判定的完整链路：观察期恢复曲线评估为「复发」时，系统自动重新会诊并自动生成阈值调整建议。"
                dataSource="运行态真实数据：事件状态机 + 观察期反馈评估 + 诊断记录表（近 30 天滚动窗口）。"
                insight="这条闭环的价值在于「系统会自己发现自己错了」——复发不再需要人工回头看。"
              />
            }
          >
            <NodeChain nodes={INNER_NODES} />
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 16 }}>
              <Statistic
                title="近 30 天事件总数"
                value={inner?.total_events ?? '—'}
                valueStyle={{ color: "var(--status-info)" }}
              />
              <Statistic
                title="观察期判定·已恢复"
                value={inner?.feedback_verdict?.recovered ?? '—'}
                valueStyle={{ color: "var(--status-ok)" }}
              />
              <Statistic
                title="观察期判定·复发"
                value={inner?.feedback_verdict?.relapsed ?? '—'}
                valueStyle={{ color: "var(--status-danger)" }}
              />
              <Statistic
                title="自动再诊断次数"
                value={inner?.auto_reconsult_count ?? '—'}
                valueStyle={{ color: "var(--status-warn)" }}
              />
              <Statistic
                title="自动触发阈值建议"
                value={inner?.auto_suggestion_trigger_count ?? '—'}
                valueStyle={{ color: '#a86382' }}
              />
            </div>
            {inner?.note && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>{inner.note}</div>
            )}
            {inner?.by_state && Object.keys(inner.by_state).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                  事件状态分布（近 30 天）
                </div>
                <Space size={6} wrap>
                  {Object.entries(inner.by_state).map(([k, v]) => (
                    <Tag key={k} color={k === 'relapsed' ? 'red' : k === 'recovered' ? 'green' : 'blue'}>
                      {STATE_LABEL[k] ?? k}：{String(v)}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </Card>
        </Col>

        {/* ---------- 外闭环 ---------- */}
        <Col span={24} style={{ marginBottom: 16 }}>
          <Card
            title="外闭环 · 系统级进化闭环（天/周级，人工把关）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="阈值建议由复发事件自动触发，工程师采纳后写入动态阈值，直接改变下一轮异常检测的判定边界。"
                dataSource="运行态真实数据：阈值建议表 + 阈值效果跟踪表（近 30 天滚动窗口）。"
                insight="采纳率是衡量「AI 建议是否值得信」的直接指标；被拒绝的建议同样留痕，用于复盘边界。"
              />
            }
          >
            <NodeChain nodes={OUTER_NODES} />
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 16 }}>
              <Statistic
                title="阈值建议总数"
                value={outer?.suggestions_total ?? '—'}
                valueStyle={{ color: "var(--status-info)" }}
              />
              <Statistic title="已采纳" value={outer?.accepted ?? '—'} valueStyle={{ color: "var(--status-ok)" }} />
              <Statistic title="已拒绝" value={outer?.rejected ?? '—'} valueStyle={{ color: "var(--status-danger)" }} />
              <Statistic title="待决策" value={outer?.pending ?? '—'} valueStyle={{ color: "var(--status-warn)" }} />
              <Statistic
                title="人工采纳率"
                value={(outer?.adoption_rate == null ? '—' : (outer.adoption_rate * 100).toFixed(1))}
                suffix="%"
                valueStyle={{ color: '#a86382' }}
              />
              <Statistic
                title="涉及设备数"
                value={outer?.devices_involved ?? '—'}
                valueStyle={{ color: "var(--status-info)" }}
              />
            </div>
            {outer?.note && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>{outer.note}</div>
            )}
          </Card>
        </Col>

        {/* ---------- 闭环效果：系统自评指标 ---------- */}
        <Col span={24}>
          <Card
            title="闭环效果：系统自评指标（近 30 天滚动）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="双闭环持续运行的产出：诊断准确率、误报率、漏报率、平均延迟与阈值标定次数。"
                dataSource="诊断记录表（人工注入根因后判定是否正确）+ 阈值建议表，运行态真实数据。"
                insight="准确率随闭环运行逐步上升、误报率逐步下降，是「系统自己在变好」的量化证据。"
              />
            }
          >
            {m ? (
              <Row gutter={16}>
                <Col xs={12} lg={6}>
                  <Statistic
                    title="诊断准确率"
                    value={(m.accuracy * 100).toFixed(1)}
                    suffix="%"
                    valueStyle={{ color: "var(--status-info)", fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    已注入根因样本 {m.total} 条
                  </div>
                </Col>
                <Col xs={12} lg={6}>
                  <Statistic
                    title="误报率"
                    value={(m.false_alarm_rate * 100).toFixed(1)}
                    suffix="%"
                    valueStyle={{ color: "var(--status-warn)", fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>告警中实际为正常的比例</div>
                </Col>
                <Col xs={12} lg={6}>
                  <Statistic
                    title="漏报率"
                    value={(m.miss_rate * 100).toFixed(1)}
                    suffix="%"
                    valueStyle={{ color: "var(--status-danger)", fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>实际故障中判为正常的比例</div>
                </Col>
                <Col xs={12} lg={6}>
                  <Statistic
                    title="平均诊断延迟"
                    value={m.avg_latency_seconds.toFixed(1)}
                    suffix="s"
                    valueStyle={{ color: "var(--status-info)", fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    阈值累计标定 {m.threshold_calibration_count} 次
                  </div>
                </Col>
              </Row>
            ) : (
              <Empty description="暂无人工确认的诊断记录" />
            )}
          </Card>
        </Col>


      </Row>
    </Spin></LoadState>
  )
}

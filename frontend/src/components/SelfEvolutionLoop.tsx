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
  { t: '异常检测', d: '阈值+残差判定告警', c: '#f5222d' },
  { t: '多智能体会诊', d: '5 路证据 D-S 融合', c: '#fa8c16' },
  { t: '人工确认/修订', d: '确认·修改·拒绝', c: '#faad14' },
  { t: '下发指令', d: '进入处置中', c: '#22d3ee' },
  { t: '观察期评估', d: '恢复曲线偏差判定', c: '#38bdf8' },
  { t: '自动回流', d: '恢复记准确率 / 复发自动再诊断', c: '#52c41a' },
]

// 外闭环链路节点：反馈累积 → 阈值建议 → 人工采纳 → 阈值生效 → 影响下一轮检测
const OUTER_NODES = [
  { t: '反馈累积', d: '准确率/误报/漏报', c: '#722ed1' },
  { t: '阈值建议生成', d: '复发事件自动触发', c: '#eb2f96' },
  { t: '人工采纳/拒绝', d: '工程师决策留痕', c: '#fa8c16' },
  { t: '动态阈值生效', d: '写入设备判定边界', c: '#22d3ee' },
  { t: '反哺下一轮检测', d: '改变异常判定结果', c: '#52c41a' },
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
              borderRadius: 6,
              background: 'rgba(15, 32, 56, 0.75)',
              border: `1px solid ${n.c}55`,
              borderLeft: `3px solid ${n.c}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{n.t}</div>
            <div style={{ fontSize: 11, color: '#78879b', marginTop: 2 }}>{n.d}</div>
          </div>
          {i < nodes.length - 1 && <span style={{ color: '#475569', fontSize: 16 }}>→</span>}
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

  useEffect(() => {
    let active = true
    getSelfEvalLoops()
      .then((d) => {
        if (active) setData(d)
      })
      .catch(() => {})
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
    <Spin spinning={loading}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 12 }}>
          <Space size={8} wrap>
            <Tag color="cyan">创新点五</Tag>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>
              内闭环（事件级自动再诊断）× 外闭环（阈值建议人工采纳沉淀为系统能力）
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
                value={inner?.total_events ?? 0}
                valueStyle={{ color: '#22d3ee' }}
              />
              <Statistic
                title="观察期判定·已恢复"
                value={inner?.feedback_verdict?.recovered ?? 0}
                valueStyle={{ color: '#52c41a' }}
              />
              <Statistic
                title="观察期判定·复发"
                value={inner?.feedback_verdict?.relapsed ?? 0}
                valueStyle={{ color: '#f5222d' }}
              />
              <Statistic
                title="自动再诊断次数"
                value={inner?.auto_reconsult_count ?? 0}
                valueStyle={{ color: '#fa8c16' }}
              />
              <Statistic
                title="自动触发阈值建议"
                value={inner?.auto_suggestion_trigger_count ?? 0}
                valueStyle={{ color: '#eb2f96' }}
              />
            </div>
            {inner?.note && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>{inner.note}</div>
            )}
            {inner?.by_state && Object.keys(inner.by_state).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#78879b', marginBottom: 6 }}>
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
                value={outer?.suggestions_total ?? 0}
                valueStyle={{ color: '#22d3ee' }}
              />
              <Statistic title="已采纳" value={outer?.accepted ?? 0} valueStyle={{ color: '#52c41a' }} />
              <Statistic title="已拒绝" value={outer?.rejected ?? 0} valueStyle={{ color: '#f5222d' }} />
              <Statistic title="待决策" value={outer?.pending ?? 0} valueStyle={{ color: '#faad14' }} />
              <Statistic
                title="人工采纳率"
                value={((outer?.adoption_rate ?? 0) * 100).toFixed(1)}
                suffix="%"
                valueStyle={{ color: '#eb2f96' }}
              />
              <Statistic
                title="涉及设备数"
                value={outer?.devices_involved ?? 0}
                valueStyle={{ color: '#38bdf8' }}
              />
            </div>
            {outer?.note && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>{outer.note}</div>
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
                    valueStyle={{ color: '#22d3ee', fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: '#78879b' }}>
                    已注入根因样本 {m.total} 条
                  </div>
                </Col>
                <Col xs={12} lg={6}>
                  <Statistic
                    title="误报率"
                    value={(m.false_alarm_rate * 100).toFixed(1)}
                    suffix="%"
                    valueStyle={{ color: '#faad14', fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: '#78879b' }}>告警中实际为正常的比例</div>
                </Col>
                <Col xs={12} lg={6}>
                  <Statistic
                    title="漏报率"
                    value={(m.miss_rate * 100).toFixed(1)}
                    suffix="%"
                    valueStyle={{ color: '#f5222d', fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: '#78879b' }}>实际故障中判为正常的比例</div>
                </Col>
                <Col xs={12} lg={6}>
                  <Statistic
                    title="平均诊断延迟"
                    value={m.avg_latency_seconds.toFixed(1)}
                    suffix="s"
                    valueStyle={{ color: '#38bdf8', fontSize: 28 }}
                  />
                  <div style={{ fontSize: 11, color: '#78879b' }}>
                    阈值累计标定 {m.threshold_calibration_count} 次
                  </div>
                </Col>
              </Row>
            ) : (
              <Empty description="暂无已注入根因的诊断记录（在智能会诊中确认事件并注入根因后产生）" />
            )}
          </Card>
        </Col>

        {/* ---------- 两个闭环的差异说明 ---------- */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="两个闭环的分工" styles={{ body: cardBodyStyle }}>
            <Table
              size="small"
              rowKey="k"
              pagination={false}
              dataSource={[
                {
                  k: '内闭环',
                  scope: '单个事件',
                  period: '分钟级',
                  trigger: '观察期恢复曲线评估',
                  human: '不需人工介入（确认/修改/拒绝除外）',
                  output: '自动再诊断 + 自动生成阈值建议 + 准确率记录',
                },
                {
                  k: '外闭环',
                  scope: '整个系统',
                  period: '天 / 周级',
                  trigger: '阈值建议生成',
                  human: '必须人工采纳才生效（可拒绝并留痕）',
                  output: '动态阈值更新 → 改变下一轮异常判定边界',
                },
              ]}
              columns={[
                { title: '闭环', dataIndex: 'k', key: 'k', width: 80 },
                { title: '作用范围', dataIndex: 'scope', key: 'scope', width: 100 },
                { title: '周期', dataIndex: 'period', key: 'period', width: 90 },
                { title: '触发条件', dataIndex: 'trigger', key: 'trigger' },
                { title: '人工参与', dataIndex: 'human', key: 'human' },
                { title: '产出', dataIndex: 'output', key: 'output' },
              ]}
            />
            <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
              设计要点：内闭环负责"快"——事件发生后就地自我修正；外闭环负责"稳"——
              任何会改变判定边界的改动都必须经人工确认，避免模型自我漂移（catastrophic drift）。
            </div>
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}

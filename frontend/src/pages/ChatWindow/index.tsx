import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Upload,
  message,
} from 'antd'
import DigitalHuman3D, {
  moodFromHealthLevel,
  speakChinese,
  stopChineseSpeech,
  type DigitalMood,
} from '../../components/DigitalHuman3D'
import {
  confirmEvent,
  createEvent,
  detectVision,
  executeEvent,
  getDevices,
  getDeviceWindow,
  rejectEvent,
  reviseEvent,
  type AgentResult,
  type ConsultResult,
  type Device,
  type DiagnosisReport,
} from '../../services/api'

// 部件表面视觉证据（第五路证据，参与 D-S 融合与振动-视觉交叉验证）
interface VisionEvidence {
  available: boolean
  damage_type: string | null
  confidence: number
  count: number
}

// 事件状态机状态 -> 中文标签与配色（与后端 command_loop 状态机一致）
const STATE_META: Record<string, { label: string; color: string }> = {
  normal: { label: '正常', color: 'green' },
  warning: { label: '预警', color: 'gold' },
  alarm: { label: '告警', color: 'red' },
  consulting: { label: '会诊中', color: 'blue' },
  pending: { label: '待确认', color: 'orange' },
  handling: { label: '处置中', color: 'volcano' },
  observing: { label: '观察期', color: 'cyan' },
  recovered: { label: '已恢复', color: 'green' },
  relapsed: { label: '复发', color: 'magenta' },
}

// Agent 角色 -> 展示配色与中文名
const AGENT_STYLE: Record<string, { name: string; color: string; bg: string }> = {
  signal_analyst: { name: '信号分析师', color: '#38bdf8', bg: 'rgba(56, 139, 248, 0.14)' },
  physical_residual: { name: '物理推理师', color: '#52c41a', bg: 'rgba(82, 196, 26, 0.14)' },
  knowledge_retrieval: { name: '知识检索师', color: '#722ed1', bg: 'rgba(167, 139, 250, 0.18)' },
  fault_diagnosis: { name: '故障分类师', color: '#13c2c2', bg: 'rgba(45, 212, 191, 0.14)' },
  vision_inspection: { name: '视觉检测 Agent', color: '#eb2f96', bg: 'rgba(235, 47, 150, 0.14)' },
  decision: { name: '会诊主席', color: '#fa8c16', bg: 'rgba(250, 140, 22, 0.16)' },
}

// 视觉检出的表面损伤类型 -> 中文名（与后端 vision_agent.DAMAGE_LABELS_ZH 一致）
const DAMAGE_LABELS_ZH: Record<string, string> = {
  crazing: '裂纹',
  inclusion: '夹杂',
  patches: '斑块',
  pitted_surface: '点蚀',
  'rolled-in_scale': '氧化铁皮',
  scratches: '划痕',
}

interface ChatMessage {
  kind: 'alert' | 'agent' | 'report'
  text?: string
  agent?: AgentResult
  report?: DiagnosisReport
  diagnosis?: ConsultResult
}

// 无真实窗口时的演示振动信号（用于触发会诊链路）
function demoWindow(n = 64): Array<{ vibration: number }> {
  return Array.from({ length: n }, (_, i) => ({
    vibration: +(0.25 + 0.18 * Math.sin(i / 6) + (i / n) * 0.25 + Math.random() * 0.08).toFixed(4),
  }))
}

// 报告卡片需展示的关键部分
// 数字人情绪 -> 中文状态说明
const MOOD_LABEL: Record<DigitalMood, string> = {
  idle: '待机',
  healthy: '运行正常',
  degraded: '预警 · 退化',
  fault: '故障告警',
}

// 数字人情绪 -> 状态标签文字颜色（与大屏语义色一致）
const MOOD_LABEL_COLOR: Record<DigitalMood, string> = {
  idle: '#38bdf8',
  healthy: '#22d3ee',
  degraded: '#faad14',
  fault: '#f5222d',
}

const REPORT_SECTIONS: Array<{ key: keyof DiagnosisReport; title: string }> = [
  { key: 'summary', title: '发生了什么' },
  { key: 'physical_evidence', title: '物理证据' },
  { key: 'signal_evidence', title: '信号证据' },
  { key: 'knowledge_basis', title: '知识依据' },
  { key: 'impact', title: '影响评估' },
]

export default function ChatWindow() {
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string>()
  const [eventId, setEventId] = useState<number>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [mood, setMood] = useState<DigitalMood>('idle')
  const [speaking, setSpeaking] = useState(false)
  // 处置闭环：事件状态 / 下发指令编号 / 弹窗
  const [eventState, setEventState] = useState<string>()
  const [commandId, setCommandId] = useState<string>()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseForm, setReviseForm] = useState({ recommendation: '', fault_label: '', note: '' })
  const [acting, setActing] = useState(false)
  // 部件表面视觉检测结果（第五路证据，可选；不上传则不参与融合）
  const [vision, setVision] = useState<VisionEvidence>()
  const [visionLoading, setVisionLoading] = useState(false)
  const timerRef = useRef<number[]>([])
  const lastDiagRef = useRef<ConsultResult | undefined>(undefined)

  useEffect(() => {
    getDevices().then((d) => {
      setDevices(d)
      if (d.length > 0) setDeviceId(d[0].id)
    })
    return () => {
      timerRef.current.forEach(clearTimeout)
      stopChineseSpeech()
    }
  }, [])

  // 让数字人播报会诊结论
  const speakReport = (diag: ConsultResult | undefined, devId: string) => {
    if (!diag) return
    lastDiagRef.current = diag
    const conf = ((diag.confidence ?? 0) * 100).toFixed(0)
    const hs = diag.health_score != null ? diag.health_score.toFixed(0) : '--'
    const summary = diag.report?.summary ?? ''
    const rec = diag.report?.recommendation ?? ''
    const text =
      `设备 ${devId} 诊断完成。结论为：${diag.fault_label || diag.fault_type || '未知'}，` +
      `置信度 ${conf}%，健康分 ${hs} 分。${summary}${rec ? `建议：${rec}` : ''}`
    setMood(moodFromHealthLevel(diag.health_level))
    if (speakChinese(text, () => setSpeaking(false))) {
      setSpeaking(true)
    }
  }

  // 重播上一次会诊结论 / 停止播报
  const replay = () => {
    if (!deviceId || !lastDiagRef.current) return
    speakReport(lastDiagRef.current, deviceId)
  }
  const stopSpeak = () => {
    stopChineseSpeech()
    setSpeaking(false)
  }

  // 会诊：通过 command_loop 创建事件（内部自动触发多智能体会诊）
  const startConsult = async () => {
    if (!deviceId) return
    const devId = deviceId
    setLoading(true)
    setMessages([])
    setEventId(undefined)
    setMood('idle')
    setSpeaking(false)
    stopChineseSpeech()
    try {
      let windowData = await getDeviceWindow(deviceId)
      if (!Array.isArray(windowData) || windowData.length === 0) {
        windowData = demoWindow()
      }
      const event = await createEvent(deviceId, windowData, 'system', vision)
      setEventId(event.id)
      setEventState(event.status_state ?? 'pending')
      setCommandId(undefined)

      const diag: ConsultResult | undefined = event.agent_diagnosis
      const agents = diag?.agent_results ?? []
      const seq: ChatMessage[] = [
        {
          kind: 'alert',
          text:
            `设备 ${deviceId} 触发异常，已启动多智能体会诊（事件 #${event.id}）` +
            (vision?.available
              ? `。已接入部件表面视觉证据：${vision.damage_type ? `检出「${DAMAGE_LABELS_ZH[vision.damage_type] ?? vision.damage_type}」${vision.count} 处` : '未见明显表面损伤'}，作为第五路证据参与 D-S 融合与振动-视觉交叉验证。`
              : '（未上传部件表面图像，视觉证据不参与融合）'),
        },
      ]
      agents.forEach((a) => seq.push({ kind: 'agent', agent: a }))
      seq.push({ kind: 'report', report: diag?.report, diagnosis: diag })

      // 依次出现（每 500ms 一条），模拟会诊节奏
      let idx = 0
      timerRef.current.forEach(clearTimeout)
      const finalAgentOrder = [...agents]
      let built: ChatMessage[] = [{ ...seq[0] }]
      // 首条告警立即显示
      setMessages([...built])
      let i = 0
      for (const a of finalAgentOrder) {
        i += 1
        timerRef.current.push(
          window.setTimeout(() => {
            built = [...built, { kind: 'agent', agent: a }]
            setMessages([...built])
          }, i * 500),
        )
      }
      timerRef.current.push(
        window.setTimeout(() => {
          built = [...built, { kind: 'report', report: diag?.report, diagnosis: diag }]
          setMessages([...built])
          // 报告出现后，让数字人同步播报结论
          speakReport(diag, devId)
        }, (i + 1) * 500),
      )
    } catch (e) {
      message.error('会诊失败，请检查后端是否运行')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 上传部件表面图像（解体检修 / 内窥镜拍摄），先做视觉检测得到表面损伤类型，
   * 检测结果作为「第五路证据」随会诊请求一起提交，参与 D-S 融合与振动-视觉交叉验证。
   * 不上传则不参与融合，系统退化为四路振动侧证据。
   */
  const onVisionUpload = async (file: File) => {
    setVisionLoading(true)
    try {
      const res = await detectVision(file)
      const dets: Array<{ class: string; confidence: number }> = res?.detections ?? []
      const top = dets[0]
      setVision({
        available: true,
        damage_type: top ? top.class : null,
        confidence: top ? Number(top.confidence ?? 0) : 0,
        count: Number(res?.count ?? dets.length),
      })
      message.success(
        top
          ? `视觉检测完成：检出「${DAMAGE_LABELS_ZH[top.class] ?? top.class}」${res?.count ?? dets.length} 处，已作为第五路证据接入会诊`
          : '视觉检测完成：部件表面未见明显损伤，已作为一致性确认证据接入会诊',
      )
    } catch (e) {
      message.error('视觉检测失败，本次会诊将不纳入视觉证据')
      console.error(e)
      setVision(undefined)
    } finally {
      setVisionLoading(false)
    }
    return false // 阻止 antd 默认上传行为，图片不出网、仅本地推理
  }

  /**
   * 确认执行：人工确认（pending -> handling）后立即下发指令（handling -> observing）。
   * 下发的指令内容取「可能被人工修改过的」最新维护建议，保证现场执行与页面一致。
   */
  const onConfirm = async () => {
    if (!eventId) return
    setActing(true)
    try {
      const confirmed = await confirmEvent(eventId, 'operator')
      setEventState(confirmed?.status_state ?? 'handling')
      const cmd = lastDiagRef.current?.report?.recommendation
      const res = await executeEvent(eventId, 'operator', cmd)
      setCommandId(res?.command_id)
      setEventState(res?.event?.status_state ?? 'observing')
      message.success(
        res?.command_id
          ? `已确认执行，指令已下发（${res.command_id}），事件进入观察期`
          : '已确认执行，进入处置流程',
      )
    } catch (e) {
      message.error('确认执行失败：事件当前状态不允许该操作或非告警事件')
      console.error(e)
    } finally {
      setActing(false)
    }
  }

  /** 拒绝：必须填写拒绝理由，回退到告警态重新评估，理由写入审计时间线 */
  const onReject = async () => {
    if (!eventId) return
    setActing(true)
    try {
      const res = await rejectEvent(eventId, 'operator', rejectReason.trim() || '人工拒绝')
      setEventState(res?.status_state ?? 'alarm')
      setCommandId(undefined)
      message.success('已拒绝该诊断建议，事件退回告警态重新评估')
      setRejectOpen(false)
      setRejectReason('')
    } catch (e) {
      message.error('拒绝失败')
      console.error(e)
    } finally {
      setActing(false)
    }
  }

  /**
   * 修改建议：工程师可修正 AI 给的故障结论与维护建议。
   * 后端改写报告并写审计时间线（状态机状态不变），前端同步刷新报告卡片。
   */
  const openRevise = () => {
    const d = lastDiagRef.current
    setReviseForm({
      recommendation: d?.report?.recommendation ?? '',
      fault_label: d?.fault_label ?? d?.fault_type ?? '',
      note: '',
    })
    setReviseOpen(true)
  }

  const onReviseSubmit = async () => {
    if (!eventId) return
    if (!reviseForm.recommendation.trim() && !reviseForm.fault_label.trim()) {
      message.warning('请至少修改「维护建议」或「故障结论」其中一项')
      return
    }
    setActing(true)
    try {
      const res = await reviseEvent(eventId, 'operator', {
        recommendation: reviseForm.recommendation,
        fault_label: reviseForm.fault_label,
        note: reviseForm.note,
      })
      // 用后端返回的最新诊断结果刷新报告卡片
      const newDiag: ConsultResult | undefined = res?.agent_diagnosis
      if (newDiag) {
        lastDiagRef.current = newDiag
        setMessages((prev) =>
          prev.map((m) => (m.kind === 'report' ? { ...m, diagnosis: newDiag, report: newDiag.report } : m)),
        )
      }
      message.success('建议已修改并留痕（可在「事件时间线」查看审计记录）')
      setReviseOpen(false)
    } catch (e) {
      message.error('修改失败')
      console.error(e)
    } finally {
      setActing(false)
    }
  }

  const renderMessage = (m: ChatMessage, idx: number) => {
    if (m.kind === 'alert') {
      return (
        <Card key={idx} size="small" style={{ background: 'rgba(245, 34, 45, 0.14)', borderColor: 'rgba(245, 34, 45, 0.40)' }}>
          <Tag color="red">系统告警</Tag> {m.text}
        </Card>
      )
    }
    if (m.kind === 'agent') {
      const s = AGENT_STYLE[m.agent!.agent_role] ?? { name: m.agent!.agent_name, color: '#78879b', bg: 'rgba(148, 163, 184, 0.10)' }
      return (
        <Card key={idx} size="small" style={{ background: s.bg }}>
          <div style={{ marginBottom: 8 }}>
            <Tag color={s.color}>{s.name}</Tag>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>
              置信度 {(m.agent!.confidence * 100).toFixed(1)}%
            </span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.agent!.conclusion}</div>
          <div style={{ color: '#78879b', fontSize: 12, marginTop: 6 }}>{m.agent!.evidence}</div>
          <Collapse
            size="small"
            ghost
            items={[
              {
                key: 'detail',
                label: '查看推理过程',
                children: <pre style={{ fontSize: 12 }}>{JSON.stringify(m.agent!.details, null, 2)}</pre>,
              },
            ]}
          />
        </Card>
      )
    }
    // report
    const r = m.report ?? {}
    const diag = m.diagnosis
    const stateMeta = eventState ? STATE_META[eventState] : undefined
    const revised = (diag as (ConsultResult & { human_revision?: { note?: string; changes?: string[] } }) | undefined)
      ?.human_revision
    return (
      <Card key={idx} title="诊断报告" style={{ background: 'rgba(250, 173, 20, 0.14)', borderColor: 'rgba(250, 173, 20, 0.40)' }}>
        {diag && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#fa8c16' }}>
              {diag.fault_label ?? diag.fault_type}
            </span>
            <span style={{ marginLeft: 12, color: '#78879b' }}>
              置信度 {(diag.confidence * 100).toFixed(1)}% · 健康分 {diag.health_score?.toFixed(1)}
            </span>
            {stateMeta && (
              <Tag color={stateMeta.color} style={{ marginLeft: 12 }}>
                事件状态：{stateMeta.label}
              </Tag>
            )}
            {commandId && <Tag color="cyan">指令编号：{commandId}</Tag>}
            {revised && <Tag color="purple">已人工修订</Tag>}
          </div>
        )}
        {REPORT_SECTIONS.map((s) =>
          r[s.key] ? (
            <div key={s.key} style={{ marginBottom: 8 }}>
              <strong>{s.title}</strong>
              <div style={{ fontSize: 13 }}>{String(r[s.key])}</div>
            </div>
          ) : null,
        )}
        {(() => {
          const ve = r.vision_evidence as
            | { text?: string; kind?: string; is_early_warning?: boolean; vision_damage_label?: string | null }
            | undefined
          if (!ve?.text) return null
          const color = ve.is_early_warning ? 'orange' : ve.kind === 'strong_corroboration' ? 'green' : 'blue'
          return (
            <div style={{ marginBottom: 8 }}>
              <strong>多模态交叉验证（振动 × 视觉）</strong>
              <div style={{ fontSize: 13 }}>
                <Tag color={color}>{ve.kind === 'strong_corroboration' ? '双模态互证' : ve.is_early_warning ? '早期窗口期' : '交叉验证'}</Tag>
                {ve.text}
              </div>
            </div>
          )
        })()}
        {r.recommendation ? (
          <div style={{ marginBottom: 8 }}>
            <strong>建议动作</strong>
            <div style={{ fontSize: 13 }}>{String(r.recommendation)}</div>
          </div>
        ) : null}
        {Array.isArray(r.follow_up_questions) && r.follow_up_questions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <strong>追问</strong>
            <div>
              {r.follow_up_questions.map((q) => (
                <Button key={String(q)} size="small" style={{ margin: '2px 4px 2px 0' }}>
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}
        {revised && (
          <div style={{ marginBottom: 8, fontSize: 12, color: '#94a3b8' }}>
            <strong style={{ color: '#a78bfa' }}>人工修订记录：</strong>
            {(revised.changes ?? []).join('；')}
            {revised.note ? `（说明：${revised.note}）` : ''}
          </div>
        )}
        <Space style={{ marginTop: 12 }} wrap>
          <Button type="primary" loading={acting} disabled={!eventId} onClick={onConfirm}>
            确认执行
          </Button>
          <Button disabled={!eventId} onClick={openRevise}>
            修改建议
          </Button>
          <Button danger loading={acting} disabled={!eventId} onClick={() => setRejectOpen(true)}>
            拒绝
          </Button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            确认=下发维护指令并进入观察期；修改=人工修正建议后留痕；拒绝=退回告警重新评估
          </span>
        </Space>
      </Card>
    )
  }

  return (
    <Row gutter={16}>
      <Col xs={24} lg={8} xl={7}>
        <Card
          title="数字人诊断助手"
          style={{ marginBottom: 16 }}
          styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
        >
          <DigitalHuman3D mood={mood} speaking={speaking} size={320} />
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            状态：
            <span style={{ color: MOOD_LABEL_COLOR[mood], fontWeight: 600 }}>{MOOD_LABEL[mood]}</span>
            {speaking && <span style={{ marginLeft: 8, color: '#22d3ee' }}>正在播报…</span>}
          </div>
          <Space size={8} style={{ justifyContent: 'center', width: '100%' }}>
            <Button size="small" onClick={replay} disabled={!lastDiagRef.current}>
              重播结论
            </Button>
            <Button size="small" onClick={stopSpeak} disabled={!speaking}>
              停止播报
            </Button>
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={16} xl={17}>
        <Card title="AI 诊断助手" style={{ marginBottom: 16 }}>
          <Space wrap>
            <Select
              style={{ width: 220 }}
              placeholder="选择设备"
              value={deviceId}
              onChange={setDeviceId}
              options={devices.map((d) => ({ value: d.id, label: `${d.name}（${d.id}）` }))}
            />
            <Button type="primary" loading={loading} onClick={startConsult}>
              发起会诊
            </Button>
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={onVisionUpload}
              disabled={visionLoading}
            >
              <Button loading={visionLoading}>
                {visionLoading ? '视觉检测中…' : '上传部件表面图像（可选）'}
              </Button>
            </Upload>
            {vision?.available && (
              <Space size={4}>
                <Tag color="magenta">
                  视觉证据：
                  {vision.damage_type
                    ? `${DAMAGE_LABELS_ZH[vision.damage_type] ?? vision.damage_type} × ${vision.count}（${(vision.confidence * 100).toFixed(0)}%）`
                    : '未见明显表面损伤'}
                </Tag>
                <Button size="small" type="link" onClick={() => setVision(undefined)}>
                  清除
                </Button>
              </Space>
            )}
          </Space>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
            视觉检测看部件「表面形貌」（点蚀/划痕/裂纹），振动诊断看设备「动态响应」，二者判的是同一类失效的两种表现。
            上传解体检修或内窥镜图像后，视觉将作为第五路证据参与 D-S 证据融合；不上传则仅用四路振动侧证据。
          </div>
        </Card>

        <Spin spinning={loading}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {messages.length === 0 && !loading ? (
              <Card>
                <Empty description="选择设备并点击「发起会诊」开始" />
              </Card>
            ) : (
              messages.map(renderMessage)
            )}
          </Space>
        </Spin>
      </Col>

      {/* 修改建议：人工修正故障结论 / 维护建议，提交后后端改写报告并留痕 */}
      <Modal
        title="修改诊断建议"
        open={reviseOpen}
        onCancel={() => setReviseOpen(false)}
        onOk={onReviseSubmit}
        okText="提交修改"
        cancelText="取消"
        confirmLoading={acting}
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>故障结论</div>
          <Input
            value={reviseForm.fault_label}
            onChange={(e) => setReviseForm({ ...reviseForm, fault_label: e.target.value })}
            placeholder="如：滚动体磨损（ball）"
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>维护建议</div>
          <Input.TextArea
            rows={3}
            value={reviseForm.recommendation}
            onChange={(e) => setReviseForm({ ...reviseForm, recommendation: e.target.value })}
            placeholder="如：降载至 70% 运行，24 小时内安排停机更换轴承"
          />
        </div>
        <div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>修改理由（写入审计时间线）</div>
          <Input.TextArea
            rows={2}
            value={reviseForm.note}
            onChange={(e) => setReviseForm({ ...reviseForm, note: e.target.value })}
            placeholder="如：现场点检未见异响，先降载观察"
          />
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
          提示：修改不会改变事件状态，原文与修改内容会一并留痕，便于复盘 AI 建议采纳率。
        </div>
      </Modal>

      {/* 拒绝：必须填写理由 */}
      <Modal
        title="拒绝该诊断建议"
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={onReject}
        okText="确认拒绝"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={acting}
      >
        <div style={{ fontSize: 13, marginBottom: 4 }}>拒绝理由（写入审计时间线）</div>
        <Input.TextArea
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="如：误报，该设备刚完成检修，振动升高为启机过程正常现象"
        />
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
          拒绝后事件退回「告警」状态重新评估，不会下发任何指令。
        </div>
      </Modal>
    </Row>
  )
}
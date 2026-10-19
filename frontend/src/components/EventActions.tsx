import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Space, message } from 'antd'
import {
  confirmEvent,
  executeEvent,
  rejectEvent,
  reviseEvent,
  type EventSummary,
} from '../services/api'
import { errorText } from '../hooks/useResource'
import { usePicoOptional } from '../features/pico/core/PicoProvider'

export default function EventActions({
  event,
  onChanged,
}: {
  event: EventSummary
  onChanged: () => void
}) {
  const [mode, setMode] = useState<
    'confirm' | 'execute' | 'reject' | 'revise'
  >()
  const [busy, setBusy] = useState(false)
  const [awaitingRefresh, setAwaitingRefresh] = useState(false)
  useEffect(() => {
    setAwaitingRefresh(false)
  }, [event])
  // 刷新失败时 useResource 会保留旧引用，event 不变则上面的 effect 不会触发；
  // 这里加超时兜底，保证按钮不会永久禁用。
  useEffect(() => {
    if (!awaitingRefresh) return
    const timer = setTimeout(() => setAwaitingRefresh(false), 4000)
    return () => clearTimeout(timer)
  }, [awaitingRefresh])
  const [reason, setReason] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [fault, setFault] = useState('')
  const [sent, setSent] = useState<string>()
  const [failure, setFailure] = useState('')
  const pico = usePicoOptional()
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const pending = event.status_state === 'pending'
  const handling = event.status_state === 'handling'
  const open = (next: typeof mode) => {
    setReason('')
    setFailure('')
    setRecommendation(String(event.report?.recommendation ?? ''))
    setFault(event.agent_diagnosis?.fault_label ?? event.fault_type ?? '')
    setMode(next)
  }
  const submit = async () => {
    if (!mode || busy || awaitingRefresh) return
    if ((mode === 'execute' && !handling) || (mode !== 'execute' && !pending)) {
      setFailure('事件状态已更新，请刷新后重试')
      return
    }
    if ((mode === 'reject' || mode === 'revise') && !reason.trim()) {
      setFailure('请填写原因')
      return
    }
    if (mode === 'revise' && (!recommendation.trim() || !fault.trim())) {
      setFailure('请填写故障结论和维护建议')
      return
    }
    let operator = 'operator'
    try {
      operator =
        JSON.parse(localStorage.getItem('user') ?? '{}').username || operator
    } catch {
      /* Backend validates request. */
    }
    setBusy(true)
    setFailure('')
    try {
      if (mode === 'confirm') await confirmEvent(event.id, operator)
      if (mode === 'reject')
        await rejectEvent(event.id, operator, reason.trim())
      if (mode === 'revise')
        await reviseEvent(event.id, operator, {
          recommendation: recommendation.trim(),
          fault_label: fault.trim(),
          note: reason.trim(),
        })
      if (mode === 'execute') {
        const response = await executeEvent(
          event.id,
          operator,
          recommendation || undefined,
        )
        if (alive.current)
          setSent(
            response.command_id ? String(response.command_id) : '编号未返回',
          )
      }
      if (alive.current) {
        message.success(
          mode === 'execute' ? '指令已下发，等待设备回执' : '操作已保存',
        )
        setAwaitingRefresh(true)
        setMode(undefined)
        onChanged()
        pico?.notify({
          title: `事件 #${event.id}`,
          text:
            mode === 'execute'
              ? '维护指令已下发，等待设备回执。'
              : '人工操作已保存，事件状态已更新。',
          severity: mode === 'reject' ? 'warning' : 'info',
          eventId: event.id,
          deviceId: event.device_id,
        })
      }
    } catch (error) {
      if (alive.current) setFailure(errorText(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const titles = {
    confirm: '确认诊断建议',
    execute: '下发维护指令',
    reject: '拒绝诊断建议',
    revise: '修改诊断建议',
  }
  return (
    <>
      {(sent || event.status_state === 'observing') && (
        <Alert
          showIcon
          type="info"
          message={sent ? `指令已下发 · ${sent}` : '事件处于观察期'}
          description="设备回执暂不可查询；恢复状态以服务端评估结果为准。"
        />
      )}
      <div className="actions-row">
        <Button
          type="primary"
          disabled={!pending || busy || awaitingRefresh}
          onClick={() => open('confirm')}
        >
          确认建议
        </Button>
        <Button
          disabled={!pending || busy || awaitingRefresh}
          onClick={() => open('revise')}
        >
          修改建议
        </Button>
        <Button
          danger
          disabled={!pending || busy || awaitingRefresh}
          onClick={() => open('reject')}
        >
          拒绝建议
        </Button>
        {handling && (
          <Button
            type="primary"
            disabled={busy || awaitingRefresh}
            onClick={() => open('execute')}
          >
            下发指令
          </Button>
        )}
      </div>
      {!pending && !handling && (
        <div className="page-meta">当前状态无需人工确认</div>
      )}
      <Modal
        title={mode ? titles[mode] : ''}
        open={Boolean(mode)}
        onCancel={() => {
          if (!busy) setMode(undefined)
        }}
        onOk={submit}
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        cancelButtonProps={{ disabled: busy }}
        okButtonProps={{ danger: mode === 'execute' || mode === 'reject' }}
        okText={mode === 'execute' ? '确认下发' : '确认'}
        cancelText="取消"
        destroyOnHidden
      >
        {failure && <Alert type="error" showIcon message={failure} />}
        {mode === 'confirm' && (
          <p>
            确认事件 #{event.id}{' '}
            的诊断建议。确认后进入处置阶段，维护指令需单独下发。
          </p>
        )}
        {mode === 'execute' && (
          <>
            <Alert
              type="warning"
              showIcon
              message={`指令将发送至 ${event.device_id}`}
            />
            <div className="evidence-block">
              <h3>维护指令</h3>
              <p>{recommendation || '使用服务端维护建议'}</p>
            </div>
          </>
        )}
        {mode === 'revise' && (
          <>
            <div className="form-field">
              <label htmlFor="revision-fault">故障结论</label>
              <Input
                id="revision-fault"
                value={fault}
                onChange={(e) => setFault(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="revision-advice">维护建议</label>
              <Input.TextArea
                id="revision-advice"
                rows={3}
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
              />
            </div>
          </>
        )}
        {(mode === 'reject' || mode === 'revise') && (
          <div className="form-field">
            <label htmlFor="event-action-reason">
              {mode === 'reject' ? '拒绝理由' : '修改理由'}
            </label>
            <Input.TextArea
              id="event-action-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              showCount
            />
          </div>
        )}
      </Modal>
    </>
  )
}

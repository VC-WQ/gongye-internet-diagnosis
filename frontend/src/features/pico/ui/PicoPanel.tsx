import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { usePico } from '../core/PicoProvider'
import { actionPath } from '../core/actions'
import type { PicoAction, PicoMessage, PicoReference } from '../core/types'
import PicoAvatar from './PicoAvatar'

const KIND_LABEL: Record<PicoReference['kind'], string> = {
  device: '设备',
  event: '事件',
  report: '报告',
  telemetry: '采样',
}

const SUGGESTIONS = [
  '这台设备怎么样？',
  '最近有哪些告警？',
  '查看当前事件报告',
]

function MetaTags({ message }: { message: PicoMessage }) {
  const meta = message.meta
  if (!meta) return null
  return (
    <div className="pico-meta">
      {meta.llm === 'live' && <Tag color="green">真实模型</Tag>}
      {meta.llm === 'unconfigured' && <Tag>AI 服务未配置 · 模板回答</Tag>}
      {meta.llm === 'fallback' && <Tag color="orange">AI 暂不可用 · 模板回答</Tag>}
      {meta.data_status === 'stale' && <Tag color="orange">数据已过期</Tag>}
      {meta.data_status === 'missing' && <Tag>缺少数据</Tag>}
    </div>
  )
}

export default function PicoPanel() {
  const {
    messages,
    busy,
    emotion,
    talking,
    contextLabel,
    deviceId,
    send,
    speak,
    stopSpeaking,
    cancel,
    setOpen,
  } = usePico()
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, busy])

  const submit = () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    void send(text)
  }

  const runAction = (action: PicoAction) => {
    const path = actionPath(action)
    if (!path) return
    navigate(path)
    setOpen(false)
  }

  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')

  return (
    <section className="pico-panel" aria-label="Pico 助手">
      <header className="pico-panel__header">
        <PicoAvatar emotion={emotion} size={44} />
        <div className="pico-panel__title">
          <strong>Pico</strong>
          <span>{contextLabel}</span>
        </div>
        <div className="pico-panel__actions">
          {lastAssistant && (
            <Button
              size="small"
              type="text"
              onClick={() =>
                talking ? stopSpeaking() : speak(lastAssistant.text)
              }
            >
              {talking ? '停止' : '朗读'}
            </Button>
          )}
          <Button
            size="small"
            type="text"
            aria-label="关闭 Pico"
            onClick={() => setOpen(false)}
          >
            关闭
          </Button>
        </div>
      </header>

      <div className="pico-panel__messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="pico-empty">
            <PicoAvatar emotion="curious" size={230} />
            <p>
              我是 Pico。可以问我当前设备状态、最近事件、事件依据或报告摘要。
              {!deviceId && ' 当前页面没有设备上下文，请先选择设备。'}
            </p>
            <div className="pico-suggestions">
              {SUGGESTIONS.map((item) => (
                <button key={item} type="button" onClick={() => void send(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`pico-message pico-message--${message.role}`}
          >
            <div className="pico-message__bubble">
              <p>{message.text}</p>
              <MetaTags message={message} />
              {message.references && message.references.length > 0 && (
                <div className="pico-refs">
                  {message.references.map((reference) => (
                    <span
                      key={`${reference.kind}:${reference.id}`}
                      className="pico-ref"
                      title={`${reference.source}${
                        reference.observed_at
                          ? ` · ${reference.observed_at}`
                          : ''
                      }`}
                    >
                      {KIND_LABEL[reference.kind]} · {reference.label}
                    </span>
                  ))}
                </div>
              )}
              {message.actions && message.actions.length > 0 && (
                <div className="pico-message__actions">
                  {message.actions.map((action) => (
                    <Button
                      key={`${action.type}:${action.target}`}
                      size="small"
                      onClick={() => runAction(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
              {message.role === 'assistant' && (
                <button
                  type="button"
                  className="pico-speak"
                  onClick={() => speak(message.text)}
                >
                  朗读
                </button>
              )}
            </div>
            {message.contextLabel && message.role === 'assistant' && (
              <span className="pico-context-note">{message.contextLabel}</span>
            )}
          </div>
        ))}

        {busy && (
          <div className="pico-message pico-message--assistant">
            <div className="pico-message__bubble pico-thinking">
              <PicoAvatar emotion="thinking" size={26} />
              <span>正在查询真实业务数据…</span>
            </div>
          </div>
        )}
      </div>

      <footer className="pico-composer">
        <Input.TextArea
          autoFocus
          value={draft}
          disabled={busy}
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="问 Pico：这台设备怎么样？"
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="pico-composer__buttons">
          <span>语音需手动点击</span>
          {busy ? (
            <Button size="small" onClick={cancel}>
              停止
            </Button>
          ) : (
            <Button size="small" type="primary" onClick={submit}>
              发送
            </Button>
          )}
        </div>
      </footer>
    </section>
  )
}

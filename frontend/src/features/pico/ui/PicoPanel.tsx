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
      {meta.source_kind === 'simulated' && <Tag>设备仿真</Tag>}
      {meta.source_kind === 'offline' && <Tag>离线数据</Tag>}
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
    speakingId,
    talking,
    speechError,
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


  return (
    <section className="pico-panel" aria-label="Pico 助手" data-pico-emotion={emotion} data-talking={talking}>
      <header className="pico-panel__header">
        <PicoAvatar emotion={emotion} size={44} />
        <div className="pico-panel__title">
          <strong>Pico</strong>
          <span>{contextLabel}</span>
        </div>
        <div className="pico-panel__actions">

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

      <div className="pico-panel__messages" data-message-count={messages.length} ref={listRef} aria-live="polite">
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
                  aria-label={speakingId === message.id ? '停止播放' : '播放回复'}
                  title={speakingId === message.id ? '停止播放' : '播放回复'}
                  aria-pressed={speakingId === message.id}
                  onClick={() => speakingId === message.id ? stopSpeaking() : speak(message.text, message.id)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    {speakingId === message.id ? <path d="M7 6h10v12H7z" fill="currentColor" /> : <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" /></>}
                  </svg>
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
        {speechError && <p role="status" className="pico-speech-error">{speechError}</p>}
        <Input.TextArea
          autoFocus
          value={draft}
          disabled={busy}
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="问 Pico：这台设备怎么样？"
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="pico-composer__buttons">
          <span className="pico-input-hint">Enter 发送 · Shift + Enter 换行</span>
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

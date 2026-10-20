import { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { usePico } from '../core/PicoProvider'
import { actionPath } from '../core/actions'
import { useSpatialNavigate } from '../../../hooks/useSpatialNavigate'
import '../pico.css'
import './workbench.css'

const SUGGESTIONS = ['这台设备怎么样？', '最近有哪些告警？', '查看当前事件报告']

export default function PicoWorkbench() {
  const {
    messages,
    busy,
    contextLabel,
    deviceId,
    speakingId,
    send,
    speak,
    stopSpeaking,
    cancel,
  } = usePico()
  const navigate = useSpatialNavigate()
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

  return (
    <section className="pico-workbench" aria-label="Pico 数字伴侣">
      <header className="pico-workbench__head">
        <div>
          <strong>Pico</strong>
          <span>{contextLabel}</span>
        </div>
        <span className="pico-workbench__hint">只读业务查询 · 与右下角共用会话</span>
      </header>
      <div className="pico-workbench__messages" ref={listRef} aria-live="polite">
        {!messages.length && (
          <div className="pico-workbench__empty">
            <p>
              可以问我当前设备状态、最近事件、事件依据或报告摘要。
              {!deviceId && ' 当前没有设备上下文，请先在工厂中选择设备。'}
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
              {message.references && message.references.length > 0 && (
                <div className="pico-refs">
                  {message.references.map((reference) => (
                    <span
                      key={`${reference.kind}:${reference.id}`}
                      className="pico-ref"
                      title={reference.source}
                    >
                      {reference.label}
                    </span>
                  ))}
                </div>
              )}
              {message.actions && message.actions.length > 0 && (
                <div className="pico-message__actions">
                  {message.actions.map((action) => {
                    const path = actionPath(action)
                    return (
                      <Button
                        key={`${action.type}:${action.target}`}
                        size="small"
                        disabled={!path}
                        onClick={() => path && navigate(path)}
                      >
                        {action.label}
                      </Button>
                    )
                  })}
                </div>
              )}
              {message.role === 'assistant' && (
                <button
                  type="button"
                  className="pico-speak"
                  aria-label={speakingId === message.id ? '停止播放' : '播放回复'}
                  aria-pressed={speakingId === message.id}
                  onClick={() =>
                    speakingId === message.id
                      ? stopSpeaking()
                      : speak(message.text, message.id)
                  }
                >
                  {speakingId === message.id ? '停止' : '朗读'}
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="pico-message pico-message--assistant">
            <div className="pico-message__bubble pico-thinking">
              <span>正在查询真实业务数据…</span>
            </div>
          </div>
        )}
      </div>
      <footer className="pico-workbench__composer">
        <Input.TextArea
          value={draft}
          disabled={busy}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder="问 Pico：这台设备怎么样？"
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="pico-workbench__buttons">
          <span>Enter 发送 · Shift + Enter 换行</span>
          {busy ? (
            <Button onClick={cancel}>停止</Button>
          ) : (
            <Button type="primary" onClick={submit}>
              发送
            </Button>
          )}
        </div>
      </footer>
    </section>
  )
}

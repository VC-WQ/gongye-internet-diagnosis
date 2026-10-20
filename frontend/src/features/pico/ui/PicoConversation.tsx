import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Popover } from 'antd'
import { usePico } from '../core/PicoProvider'
import { actionPath } from '../core/actions'
import { metaDetails, isNearBottom } from '../core/presentation'
import type { PicoAction, PicoMessage, PicoReference } from '../core/types'
import { DURATION, EASE_CSS } from '../../../motion/tokens'
import { useSpatialNavigate } from '../../../hooks/useSpatialNavigate'

const SUGGESTIONS = ['这台设备怎么样？', '最近有哪些告警？', '查看当前事件报告']

const KIND_LABEL: Record<PicoReference['kind'], string> = {
  device: '设备',
  event: '事件',
  report: '报告',
  telemetry: '采样',
}

interface Flight {
  id: string
  text: string
  from: { left: number; top: number; width: number; height: number }
  to: { left: number; top: number; width: number; height: number }
}

function MetaDetails({ message }: { message: PicoMessage }) {
  const rows = metaDetails(message.meta)
  if (!rows.length) return null
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      content={
        <dl className="pico-meta-details">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      }
    >
      <button type="button" className="pico-meta-button">
        详情
      </button>
    </Popover>
  )
}

function PicoFaceGlyph() {
  return (
    <span className="pico-empty-glyph" aria-hidden>
      <span>&gt;</span>
      <span>_</span>
    </span>
  )
}

export default function PicoConversation({
  variant,
  active,
}: {
  variant: 'dock' | 'workbench'
  active: boolean
}) {
  const {
    messages,
    busy,
    speakingId,
    speechError,
    deviceId,
    send,
    speak,
    stopSpeaking,
    cancel,
    setOpen,
  } = usePico()
  const navigate = useSpatialNavigate()
  const [draft, setDraft] = useState('')
  const [flight, setFlight] = useState<Flight>()
  const [flyingId, setFlyingId] = useState<string>()
  const listRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const pending = useRef<{ id: string; text: string; from: DOMRect } | null>(null)
  const seen = useRef<Set<string>>(new Set())
  const mounted = useRef(false)
  const nearBottom = useRef(true)
  const reduced = useRef(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduced.current = media.matches
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const onScroll = () => {
    const list = listRef.current
    if (!list) return
    nearBottom.current = isNearBottom({
      scrollHeight: list.scrollHeight,
      scrollTop: list.scrollTop,
      clientHeight: list.clientHeight,
    })
  }

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (!nearBottom.current) return
    list.scrollTop = list.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (!active) return
    nearBottom.current = true
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [active])

  // 用户文字：输入框 → 真实气泡；业务请求不等待动画。
  useLayoutEffect(() => {
    const current = pending.current
    if (!current || reduced.current) {
      if (current) pending.current = null
      return
    }
    const list = listRef.current
    const target = list?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(current.id)}"] .pico-message__bubble`,
    )
    if (!target) return
    const rect = target.getBoundingClientRect()
    const from = current.from
    pending.current = null
    setFlyingId(current.id)
    setFlight({
      id: current.id,
      text: current.text,
      from: {
        left: from.left,
        top: from.top,
        width: Math.max(60, from.width),
        height: Math.max(24, from.height),
      },
      to: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    })
  }, [messages])

  useLayoutEffect(() => {
    if (!flight) return
    const ghost = ghostRef.current
    if (!ghost) {
      setFlight(undefined)
      setFlyingId(undefined)
      return
    }
    const animation = ghost.animate(
      [
        {
          left: `${flight.from.left}px`,
          top: `${flight.from.top}px`,
          width: `${flight.from.width}px`,
          height: `${flight.from.height}px`,
          opacity: 1,
        },
        {
          left: `${flight.to.left}px`,
          top: `${flight.to.top}px`,
          width: `${flight.to.width}px`,
          height: `${flight.to.height}px`,
          opacity: 1,
        },
      ],
      { duration: DURATION.messageFlight * 1000, easing: EASE_CSS.balanced },
    )
    const finish = () => {
      setFlight(undefined)
      setFlyingId(undefined)
    }
    animation.addEventListener('finish', finish)
    animation.addEventListener('cancel', finish)
    return () => {
      animation.removeEventListener('finish', finish)
      animation.removeEventListener('cancel', finish)
      animation.cancel()
    }
  }, [flight])

  // 助手回复：从左侧窄起点连续展开，不整块闪现。
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (!mounted.current) {
      messages.forEach((message) => seen.current.add(message.id))
      mounted.current = true
      return
    }
    for (const message of messages) {
      if (message.role !== 'assistant' || seen.current.has(message.id)) continue
      seen.current.add(message.id)
      if (reduced.current) continue
      const bubble = list.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(message.id)}"] .pico-message__bubble`,
      )
      bubble?.animate(
        [
          {
            clipPath: 'inset(0 100% 0 0)',
            transform: 'translateX(-10px)',
            opacity: 0.35,
          },
          {
            clipPath: 'inset(0 0 0 0)',
            transform: 'none',
            opacity: 1,
          },
        ],
        { duration: DURATION.messageAnswer * 1000, easing: EASE_CSS.outward },
      )
    }
  }, [messages])

  useEffect(
    () => () => {
      pending.current = null
      clearTimeout(pendingTimer.current)
    },
    [],
  )

  const submit = () => {
    const text = draft.trim()
    if (!text || busy) return
    const box = composerInputRef.current?.getBoundingClientRect()
    const id = send(text)
    if (!id) return
    setDraft('')
    if (box && !reduced.current) {
      pending.current = { id, text, from: box }
      clearTimeout(pendingTimer.current)
      pendingTimer.current = setTimeout(() => {
        if (pending.current?.id === id) {
          pending.current = null
          setFlyingId(undefined)
        }
      }, 600)
    }
  }

  const runAction = (action: PicoAction) => {
    const path = actionPath(action)
    if (!path) return
    navigate(path)
    if (variant === 'dock') setOpen(false)
  }

  const result = (message: PicoMessage) => {
    if (message.role !== 'assistant') return null
    return (
      <>
        {message.references && message.references.length > 0 && (
          <div className="pico-refs">
            {message.references.map((reference) => (
              <span
                key={`${reference.kind}:${reference.id}`}
                className="pico-ref"
                title={`${reference.source}${
                  reference.observed_at ? ` · ${reference.observed_at}` : ''
                }`}
              >
                {KIND_LABEL[reference.kind]} · {reference.label}
              </span>
            ))}
          </div>
        )}
        <div className="pico-message__actions">
          {message.actions?.map((action) => (
            <Button
              key={`${action.type}:${action.target}`}
              size="small"
              disabled={!actionPath(action)}
              onClick={() => runAction(action)}
            >
              {action.label}
            </Button>
          ))}
          <button
            type="button"
            className="pico-speak"
            aria-label={speakingId === message.id ? '停止播放' : '播放回复'}
            title={speakingId === message.id ? '停止播放' : '播放回复'}
            aria-pressed={speakingId === message.id}
            onClick={() =>
              speakingId === message.id
                ? stopSpeaking()
                : speak(message.text, message.id)
            }
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              {speakingId === message.id ? (
                <path d="M7 6h10v12H7z" fill="currentColor" />
              ) : (
                <>
                  <path d="M4 9v6h4l5 4V5L8 9H4Z" />
                  <path d="M16 8c3 2 3 6 0 8" />
                </>
              )}
            </svg>
          </button>
          <MetaDetails message={message} />
        </div>
      </>
    )
  }

  return (
    <div className={`pico-conversation pico-conversation--${variant}`}>
      <div
        className="pico-conversation__messages"
        ref={listRef}
        onScroll={onScroll}
        aria-live="polite"
        data-message-count={messages.length}
      >
        {!messages.length && (
          <div className="pico-empty">
            <PicoFaceGlyph />
            <p>
              我是 Pico。可以问我当前设备状态、最近事件、事件依据或报告摘要。
              {!deviceId && ' 当前页面没有设备上下文，请先在工厂中选择设备。'}
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
            data-message-id={message.id}
            data-message-role={message.role}
            className={`pico-message pico-message--${message.role}`}
          >
            <div
              className={`pico-message__bubble ${
                flyingId === message.id ? 'is-flight-target' : ''
              }`}
            >
              <p className="pico-message__text">{message.text}</p>
              {result(message)}
            </div>
          </div>
        ))}
        {busy && (
          <div className="pico-message pico-message--assistant">
            <div className="pico-message__bubble pico-thinking">
              <span className="pico-thinking__glyph" aria-hidden>
                &gt;···
              </span>
              <span>正在查询真实业务数据…</span>
            </div>
          </div>
        )}
      </div>
      <footer className="pico-composer">
        {speechError && (
          <p role="status" className="pico-speech-error">
            {speechError}
          </p>
        )}
        <div className="pico-composer__input" ref={composerInputRef}>
        <Input.TextArea
          data-pico-input
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
        </div>
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
      {flight &&
        createPortal(
          <div
            ref={ghostRef}
            className="pico-flight-ghost"
            style={{
              left: flight.from.left,
              top: flight.from.top,
              width: flight.from.width,
              height: flight.from.height,
            }}
            aria-hidden="true"
          >
            {flight.text}
          </div>,
          document.body,
        )}
    </div>
  )
}

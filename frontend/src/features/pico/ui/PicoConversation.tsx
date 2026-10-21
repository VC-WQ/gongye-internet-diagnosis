import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Popover } from 'antd'
import { usePico } from '../core/PicoProvider'
import { actionPath } from '../core/actions'
import { referencePath } from '../core/references'
import { metaDetails, isNearBottom } from '../core/presentation'
import type { PicoAction, PicoMessage, PicoReference } from '../core/types'
import { DURATION, EASE_CSS } from '../../../motion/tokens'
import { useSpatialNavigate } from '../../../hooks/useSpatialNavigate'

const SUGGESTIONS = ['这台设备怎么样？', '健康评分最低的三台设备是哪些？', '系统用了哪些故障诊断算法？']

const KIND_LABEL: Record<PicoReference['kind'], string> = {
  device: '设备',
  event: '事件',
  report: '报告',
  telemetry: '采样',
  research: '研究',
  knowledge: '知识',
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
  const flightAnimation = useRef<Animation>()
  const answerAnimations = useRef(new Set<Animation>())
  const clearMotion = useCallback(() => {
    pending.current = null
    clearTimeout(pendingTimer.current)
    flightAnimation.current?.cancel()
    answerAnimations.current.forEach(animation => animation.cancel())
    answerAnimations.current.clear()
    setFlight(undefined)
    setFlyingId(undefined)
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduced.current = media.matches
      if (media.matches) clearMotion()
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [clearMotion])

  useLayoutEffect(() => { if (!active) clearMotion() }, [active, clearMotion])

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
    if (!current || !active || reduced.current) {
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
    if (!flight || !active || reduced.current) return
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
    flightAnimation.current = animation
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
      if (flightAnimation.current === animation) flightAnimation.current = undefined
    }
  }, [flight, active])

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
      if (!active || reduced.current) continue
      const bubble = list.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(message.id)}"] .pico-message__bubble`,
      )
      const animation = bubble?.animate(
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
      if (animation) {
        answerAnimations.current.add(animation)
        void animation.finished.catch(() => {}).finally(() => answerAnimations.current.delete(animation))
      }
    }
  }, [messages])

  useEffect(
    () => () => {
      pending.current = null
      clearTimeout(pendingTimer.current)
      answerAnimations.current.forEach(animation => animation.cancel())
      answerAnimations.current.clear()
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
            {message.references.map((reference) => {
              const key = `${reference.kind}:${reference.id}`
              const title = `${reference.source}${reference.observed_at ? ` · ${reference.observed_at}` : ''}`
              const label = `${KIND_LABEL[reference.kind]} · ${reference.label}`
              const path = referencePath(reference)
              return path ? (
                <a key={key} className="pico-ref" href={path} title={title}
                  aria-label={`查看研究依据：${reference.label}`}
                  onClick={event => { event.preventDefault(); navigate(path); if (variant === 'dock') setOpen(false) }}>
                  {label}
                </a>
              ) : <span key={key} className="pico-ref" title={title}>{label}</span>
            })}
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
              我是 Pico。可以查询设备、事件和研究资料，也能按你的要求打开页面、切换主题或预填设备表单。
              {!deviceId && ' 当前没有选定设备，你可以说出设备编号，或直接查询全厂信息。'}
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
            data-action-status={message.actionResults?.[message.actionResults.length - 1]?.status}
            className={`pico-message pico-message--${message.role}`}
          >
            <div
              className={`pico-message__bubble ${
                active && flyingId === message.id ? 'is-flight-target' : ''
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
              <span>正在处理你的请求…</span>
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
      {active && flight &&
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

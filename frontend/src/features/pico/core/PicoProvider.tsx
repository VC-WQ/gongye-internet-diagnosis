import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useDeviceCatalog } from '../../../services/realtime'
import { speakChinese, stopChineseSpeech } from '../../../services/speech'
import { useWorkspace } from '../../../services/workspace'
import { errorText } from '../../../hooks/useResource'
import { postPicoChat } from '../api/pico'
import { NotificationGate } from './notificationGate'
import { buildContextTitle } from './presentation'
import { usePicoActionExecutor } from './usePicoActionExecutor'
import { PicoExecutionGuard } from './uiActions'
import { deviceFormDraftChannel } from '../../management/deviceFormDraft'
import { buildPicoContext, canCommitPicoResponse, picoContextFingerprint, validatedPicoFocus, withPicoOverride } from './context'
import type { PicoGesture, PicoReaction } from '../animation/controller'
import type {
  PicoChatResponse,
  PicoEmotion,
  PicoMessage,
  PicoNotification,
  PicoResolvedContext,
} from './types'

interface PicoValue {
  open: boolean
  setOpen: (value: boolean) => void
  toggle: () => void
  messages: PicoMessage[]
  busy: boolean
  emotion: PicoEmotion
  reaction: PicoReaction
  react: (kind: PicoGesture) => void
  talking: boolean
  speakingId?: string
  speechError: string
  speechAvailable: boolean
  autoRead: boolean
  setAutoRead: (value: boolean) => void
  unread: boolean
  contextTitle: string
  deviceId?: string
  eventId?: number
  send: (
    text: string,
    options?: {
      override?: { device_id?: string; event_id?: number }
      userMessageId?: string
    },
  ) => string | undefined
  speak: (text: string, messageId?: string) => void
  stopSpeaking: () => void
  notify: (notification: PicoNotification) => void
  cancel: () => void
  setWorkbenchActive: (active: boolean) => void
  previewEmotion: (emotion: PicoEmotion) => void
}

const PicoContext = createContext<PicoValue | null>(null)

let sequence = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`

function isCancel(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_CANCELED'
  )
}

function readAutoRead(): boolean {
  try {
    return localStorage.getItem('pico:autoRead') === 'true'
  } catch {
    return false
  }
}

export function PicoProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace()
  const catalog = useDeviceCatalog()
  const location = useLocation()

  const [open, setOpenState] = useState(false)
  const [messages, setMessages] = useState<PicoMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [emotion, setEmotion] = useState<PicoEmotion>('idle')
  const [talking, setTalking] = useState(false)
  const [reaction, setReaction] = useState<PicoReaction>({ id: 0, kind: 'context' })
  const react = useCallback((kind: PicoGesture) => setReaction((previous) => ({ id: previous.id + 1, kind })), [])
  const [speakingId, setSpeakingId] = useState<string>()
  const [speechError, setSpeechError] = useState('')
  const [autoRead, setAutoReadState] = useState(readAutoRead)
  const [unread, setUnread] = useState(false)
  const notificationGate = useRef(new NotificationGate())
  const speechAvailable =
    typeof window !== 'undefined' && 'speechSynthesis' in window

  const busyRef = useRef(false)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const executionRef = useRef<PicoExecutionGuard>()
  const openRef = useRef(false)
  openRef.current = open
  const workbenchRef = useRef(false)
  const autoReadRef = useRef(autoRead)
  autoReadRef.current = autoRead
  const speechAvailableRef = useRef(speechAvailable)
  speechAvailableRef.current = speechAvailable

  const device = catalog.data?.find((item) => item.id === workspace.selectedDeviceId)
  const contextTitle = useMemo(
    () => buildContextTitle(workspace.area, device?.name),
    [device?.name, workspace.area],
  )
  const snapshot = buildPicoContext({
    area: workspace.area,
    pathname: location.pathname,
    search: location.search,
    deviceId: workspace.selectedDeviceId,
    eventId: workspace.selectedEventId,
    contextRevision: workspace.contextRevision,
  })
  // Local URL equality closes the render/effect revision gap. Search contents never leave this ref.
  const contextKey = JSON.stringify([picoContextFingerprint(snapshot), location.search])
  const contextRef = useRef({ snapshot, key: contextKey, url: location.pathname + location.search })
  // Update synchronously: a response can settle between render and the cancel effect.
  contextRef.current = { snapshot, key: contextKey, url: location.pathname + location.search }
  const focusRef = useRef<{ key: string; value: PicoResolvedContext }>()
  if (focusRef.current?.key !== contextKey) focusRef.current = undefined

  // A business reaction settles back to quiet idle; active work/speech owns its state.
  useEffect(() => {
    if (emotion === 'idle' || busy || talking) return
    const timer = setTimeout(() => setEmotion('idle'), 4000)
    return () => clearTimeout(timer)
  }, [emotion, busy, talking])

  const stopSpeaking = useCallback(() => {
    stopChineseSpeech()
    setTalking(false)
    setSpeakingId(undefined)
    setEmotion(busyRef.current ? 'thinking' : 'idle')
  }, [])

  const setOpen = useCallback(
    (value: boolean) => {
      if (openRef.current === value) return
      setOpenState(value)
      react(value ? 'open' : 'close')
      if (value) setUnread(false)
      else stopSpeaking()
    },
    [stopSpeaking, react],
  )
  const toggle = useCallback(() => setOpen(!openRef.current), [setOpen])
  const actionExecutor = usePicoActionExecutor(contextKey, open, setOpen)

  const setAutoRead = useCallback(
    (value: boolean) => {
      setAutoReadState(value)
      try {
        localStorage.setItem('pico:autoRead', String(value))
      } catch {
        /* 隐私模式下忽略存储失败 */
      }
      if (!value) stopSpeaking()
    },
    [stopSpeaking],
  )

  const setWorkbenchActive = useCallback((active: boolean) => {
    workbenchRef.current = active
    if (active) setUnread(false)
  }, [])

  // 上下文变化保持静默：仅取消旧请求、停止播报和失效数据。
  const lastContext = useRef(contextKey)
  useEffect(() => {
    if (lastContext.current === contextKey) return
    lastContext.current = contextKey
    react('context')
    // An executor's own navigation is expected; a user's different destination cancels it.
    if (executionRef.current?.accept(contextKey, location.pathname + location.search)) return
    requestRef.current += 1
    abortRef.current?.abort()
    busyRef.current = false
    setBusy(false)
    stopSpeaking()
  }, [
    contextKey,
    stopSpeaking,
    react,
  ])

  // 路由变化时停止播报，避免跨页面残留
  useEffect(() => {
    stopSpeaking()
    const draft = deviceFormDraftChannel.getSnapshot()
    if (draft) {
      const target = draft.mode === 'create' ? '/admin/devices' : `/manage/devices/${encodeURIComponent(draft.deviceId!)}`
      if (location.pathname !== target) deviceFormDraftChannel.clear()
    }
  }, [location.pathname, stopSpeaking])

  useEffect(
    () => () => {
      requestRef.current += 1
      abortRef.current?.abort()
      stopChineseSpeech()
      deviceFormDraftChannel.clear()
    },
    [],
  )

  const speak = useCallback(
    (text: string, messageId?: string) => {
      if (!speechAvailableRef.current) {
        setSpeechError('当前浏览器不支持语音')
        return
      }
      stopChineseSpeech()
      setSpeakingId(messageId ?? text)
      setSpeechError('')
      const queued = speakChinese(text, undefined, (state) => {
        const playing = state === 'start' || state === 'resume'
        if (playing) react('voice-start')
        else if (state === 'pause') react('voice-pause')
        else if (state === 'end' || state === 'cancel') react('voice-end')
        setTalking(playing)
        setEmotion(playing ? 'talking' : busyRef.current ? 'thinking' : 'idle')
        if (state === 'end' || state === 'error' || state === 'cancel')
          setSpeakingId(undefined)
        if (state === 'error')
          setSpeechError('语音播放失败，请检查系统语音服务')
      })
      if (!queued) {
        setSpeakingId(undefined)
        setTalking(false)
        setEmotion(busyRef.current ? 'thinking' : 'idle')
        setSpeechError('当前浏览器无法播放语音')
      }
    },
    [react],
  )

  const notify = useCallback((notification: PicoNotification) => {
    // 先判断是否值得通知；只有被接受的 critical 才允许中断当前读取。
    if (!notificationGate.current.accept(notification)) return
    react('notification')
    if (notification.severity === 'critical' && busyRef.current) {
      requestRef.current += 1
      abortRef.current?.abort()
      busyRef.current = false
      setBusy(false)
    }
    setEmotion(notification.severity === 'critical' ? 'alert' : 'curious')
    const prefix =
      notification.severity === 'critical'
        ? '重要通知'
        : notification.severity === 'warning'
          ? '注意'
          : '通知'
    setMessages((previous) => [
      ...previous,
      {
        id: nextId('notify'),
        role: 'system',
        text: notification.title
          ? `${prefix} · ${notification.title}：${notification.text}`
          : `${prefix}：${notification.text}`,
      },
    ])
    if (!openRef.current && !workbenchRef.current) setUnread(true)
  }, [react])

  const cancel = useCallback(() => {
    requestRef.current += 1
    abortRef.current?.abort()
    busyRef.current = false
    setBusy(false)
    setEmotion('idle')
    stopChineseSpeech()
    setTalking(false)
    setSpeakingId(undefined)
    setMessages((previous) => [
      ...previous,
      { id: nextId('cancel'), role: 'system', text: '已停止本次请求。' },
    ])
  }, [])

  const send = useCallback(
    (
      text: string,
      options?: {
        override?: { device_id?: string; event_id?: number }
        userMessageId?: string
      },
    ) => {
      const content = text.trim()
      if (!content || busyRef.current) return
      react('message')
      const requestId = ++requestRef.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      busyRef.current = true
      setBusy(true)
      setEmotion('thinking')
      stopChineseSpeech()
      setTalking(false)

      const userMessageId = options?.userMessageId ?? nextId('user')
      const captured = contextRef.current
      const requestContext = withPicoOverride(captured.snapshot, options?.override)
      const focus = !options?.override && focusRef.current?.key === captured.key ? focusRef.current.value : undefined
      const history = messages
        .filter((message) => message.role !== 'system')
        .slice(-6)
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.text.slice(0, 1000),
        }))
      const snapshotLabel = contextTitle
      setMessages((previous) => [
        ...previous,
        { id: userMessageId, role: 'user', text: content },
      ])

      void (async () => {
        try {
          const response: PicoChatResponse = await postPicoChat(
            {
              message: content,
              context: requestContext,
              conversation_focus: focus,
              // Keep the old fields during protocol migration; context is authoritative.
              page: requestContext.area,
              device_id: requestContext.device_id,
              event_id: requestContext.event_id,
              tab: requestContext.active_tab,
              history,
            },
            controller.signal,
          )
          if (!canCommitPicoResponse({
            requestId, currentRequestId: requestRef.current,
            fingerprint: captured.key, currentFingerprint: contextRef.current.key,
            revision: requestContext.context_revision, responseRevision: response.context_revision,
          })) return
          const resolved = validatedPicoFocus(response.resolved_context)
          if (resolved) focusRef.current = { key: captured.key, value: resolved }
          else if (response.type === 'error') focusRef.current = undefined
          react('answer')
          setMessages((previous) => [
            ...previous,
            {
              id: response.message_id,
              role: 'assistant',
              text: response.text,
              emotion: response.emotion,
              references: response.references,
              actions: response.actions,
              meta: response.meta,
              // 上下文快照只保留在不可见元数据中，供正确性检查；不再逐条渲染。
              contextLabel: snapshotLabel,
            },
          ])
          let answerText = response.text
          let answerEmotion = response.emotion
          if (response.ui_actions !== undefined && (!Array.isArray(response.ui_actions) || response.ui_actions.length)) {
            const guard = new PicoExecutionGuard(captured.key, captured.url)
            executionRef.current = guard
            const result = Array.isArray(response.ui_actions) && response.ui_actions.length === 1
              ? await actionExecutor.execute(response.ui_actions[0], controller.signal, guard)
              : { action_id: 'invalid', status: 'rejected' as const, message: '单次页面操作超出允许数量，未执行。' }
            if (executionRef.current === guard) executionRef.current = undefined
            answerText = result.message
            answerEmotion = result.status === 'succeeded' ? 'happy' : 'confused'
            setMessages(previous => previous.map(message => message.id === response.message_id
              ? { ...message, text: result.message, emotion: answerEmotion, actionResults: [result] }
              : message))
          }
          if (requestRef.current !== requestId) return
          setEmotion(answerEmotion)
          if (!openRef.current && !workbenchRef.current) setUnread(true)
          if (
            autoReadRef.current &&
            speechAvailableRef.current &&
            response.type === 'answer' && !controller.signal.aborted
          )
            speak(answerText, response.message_id)
        } catch (error) {
          if (requestRef.current !== requestId || contextRef.current.key !== captured.key || isCancel(error)) return
          setMessages((previous) => [
            ...previous,
            { id: nextId('error'), role: 'system', text: errorText(error) },
          ])
          setEmotion('confused')
        } finally {
          if (requestRef.current === requestId) {
            busyRef.current = false
            setBusy(false)
          }
        }
      })()
      return userMessageId
    },
    [messages, contextTitle, speak, react, actionExecutor],
  )

  const previewEmotion = useCallback(
    (next: PicoEmotion) => {
      stopSpeaking()
      setEmotion(next)
    },
    [stopSpeaking],
  )

  const value = useMemo<PicoValue>(
    () => ({
      open,
      setOpen,
      toggle,
      messages,
      busy,
      emotion,
      reaction,
      react,
      talking,
      speakingId,
      speechError,
      speechAvailable,
      autoRead,
      setAutoRead,
      unread,
      contextTitle,
      deviceId: workspace.selectedDeviceId,
      eventId: workspace.selectedEventId,
      send,
      speak,
      stopSpeaking,
      notify,
      cancel,
      setWorkbenchActive,
      previewEmotion,
    }),
    [
      open,
      setOpen,
      toggle,
      messages,
      busy,
      emotion,
      reaction,
      react,
      talking,
      speakingId,
      speechError,
      speechAvailable,
      autoRead,
      setAutoRead,
      unread,
      contextTitle,
      workspace.selectedDeviceId,
      workspace.selectedEventId,
      send,
      speak,
      stopSpeaking,
      notify,
      cancel,
      setWorkbenchActive,
      previewEmotion,
    ],
  )

  return <PicoContext.Provider value={value}>{children}</PicoContext.Provider>
}

export function usePico(): PicoValue {
  const value = useContext(PicoContext)
  if (!value) throw new Error('usePico must be used inside PicoProvider')
  return value
}

/** 可选读取：用于可能脱离 PicoProvider 渲染的共享组件（例如 EventActions）。 */
export function usePicoOptional(): PicoValue | null {
  return useContext(PicoContext)
}

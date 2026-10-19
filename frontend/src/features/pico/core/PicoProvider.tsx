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
import type {
  PicoChatResponse,
  PicoEmotion,
  PicoMessage,
  PicoNotification,
} from './types'

const MODE_LABEL: Record<string, string> = {
  overview: '工厂总览',
  devices: '设备监测',
  device: '设备详情',
  diagnose: '智能诊断',
  events: '事件处置',
  reports: '报告与档案',
  lab: '算法实验室',
  ops: '系统运维',
  admin: '管理',
  unknown: '工作台',
}

interface PicoValue {
  open: boolean
  setOpen: (value: boolean) => void
  toggle: () => void
  messages: PicoMessage[]
  busy: boolean
  emotion: PicoEmotion
  talking: boolean
  speakingId?: string
  speechError: string
  unread: boolean
  contextLabel: string
  deviceId?: string
  eventId?: number
  send: (
    text: string,
    override?: { device_id?: string; event_id?: number },
  ) => Promise<void>
  speak: (text: string, messageId?: string) => void
  stopSpeaking: () => void
  notify: (notification: PicoNotification) => void
  cancel: () => void
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

export function PicoProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace()
  const catalog = useDeviceCatalog()
  const location = useLocation()

  const [open, setOpenState] = useState(false)
  const [messages, setMessages] = useState<PicoMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [emotion, setEmotion] = useState<PicoEmotion>('idle')
  const [talking, setTalking] = useState(false)
  const [speakingId, setSpeakingId] = useState<string>()
  const [speechError, setSpeechError] = useState('')
  const notificationGate = useRef(new NotificationGate())
  const [unread, setUnread] = useState(false)

  // A business reaction settles back to quiet idle; active work/speech owns its state.
  useEffect(() => {
    if (emotion === 'idle' || busy || talking) return
    const timer = setTimeout(() => setEmotion('idle'), 4000)
    return () => clearTimeout(timer)
  }, [emotion, busy, talking])

  const busyRef = useRef(false)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const openRef = useRef(false)
  openRef.current = open

  const device = catalog.data?.find((item) => item.id === workspace.selectedDeviceId)
  const contextLabel = `${device?.name ?? workspace.selectedDeviceId ?? '未选择设备'} · ${
    MODE_LABEL[workspace.mode] ?? '工作台'
  }`

  const stopSpeaking = useCallback(() => {
    stopChineseSpeech()
    setTalking(false)
    setSpeakingId(undefined)
    setEmotion('idle')
  }, [])

  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value)
      if (value) setUnread(false)
      else stopSpeaking()
    },
    [stopSpeaking],
  )
  const toggle = useCallback(() => setOpen(!openRef.current), [setOpen])

  // 上下文变化保持静默：仅取消旧请求、停止播报和失效数据。
  const lastContext = useRef('')
  useEffect(() => {
    const key = `${workspace.mode}|${workspace.selectedDeviceId ?? ''}|${
      workspace.selectedEventId ?? ''
    }|${workspace.activePanel ?? ''}`
    if (!lastContext.current) {
      lastContext.current = key
      return
    }
    if (lastContext.current === key) return
    lastContext.current = key
    requestRef.current += 1
    abortRef.current?.abort()
    busyRef.current = false
    setBusy(false)
    stopSpeaking()
    setEmotion('idle')

  }, [
    workspace.mode,
    workspace.selectedDeviceId,
    workspace.selectedEventId,
    workspace.activePanel,
    contextLabel,
    stopSpeaking,
  ])

  // 路由变化时停止播报，避免跨页面残留
  useEffect(() => {
    stopSpeaking()
  }, [location.pathname, stopSpeaking])

  useEffect(() => () => {
    requestRef.current += 1
    abortRef.current?.abort()
    stopChineseSpeech()
  }, [])

  const speak = useCallback((text: string, messageId?: string) => {
    stopChineseSpeech()
    setSpeakingId(messageId ?? text)
    setSpeechError('')
    const queued = speakChinese(text, undefined, (state) => {
      const playing = state === 'start' || state === 'resume'
      setTalking(playing)
      setEmotion(playing ? 'talking' : 'idle')
      if (state === 'end' || state === 'error' || state === 'cancel') setSpeakingId(undefined)
      if (state === 'error') setSpeechError('语音播放失败，请检查系统语音服务')
    })
    if (!queued) { setSpeakingId(undefined); setTalking(false); setEmotion('idle'); setSpeechError('当前浏览器无法播放语音') }
  }, [])

  const notify = useCallback((notification: PicoNotification) => {
    // A completed business write invalidates any in-flight read even when its toast is enough.
    requestRef.current += 1
    abortRef.current?.abort()
    busyRef.current = false
    setBusy(false)
    if (!notificationGate.current.accept(notification)) return
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
    if (!openRef.current) setUnread(true)
  }, [])

  const cancel = useCallback(() => {
    requestRef.current += 1
    abortRef.current?.abort()
    busyRef.current = false
    setBusy(false)
    setEmotion('idle')
    setMessages((previous) => [
      ...previous,
      { id: nextId('cancel'), role: 'system', text: '已停止本次请求。' },
    ])
  }, [])

  const send = useCallback(
    async (
      text: string,
      override?: { device_id?: string; event_id?: number },
    ) => {
      const content = text.trim()
      if (!content || busyRef.current) return

      const requestId = ++requestRef.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      busyRef.current = true
      setBusy(true)
      setEmotion('thinking')
      stopChineseSpeech()
      setTalking(false)

      const history = messages
        .filter((message) => message.role !== 'system')
        .slice(-6)
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.text,
        }))
      const snapshotLabel = contextLabel
      setMessages((previous) => [
        ...previous,
        { id: nextId('user'), role: 'user', text: content },
      ])

      try {
        const response: PicoChatResponse = await postPicoChat(
          {
            message: content,
            page: workspace.mode,
            device_id: override?.device_id ?? workspace.selectedDeviceId,
            event_id: override?.event_id ?? workspace.selectedEventId,
            tab: workspace.activePanel,
            history,
          },
          controller.signal,
        )
        if (requestRef.current !== requestId) return
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
            contextLabel: snapshotLabel,
          },
        ])
        setEmotion(response.emotion)
        if (!openRef.current) setUnread(true)
      } catch (error) {
        if (requestRef.current !== requestId || isCancel(error)) return
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
    },
    [messages, workspace, contextLabel],
  )

  const value = useMemo<PicoValue>(
    () => ({
      open,
      setOpen,
      toggle,
      messages,
      busy,
      emotion,
      talking,
      speakingId,
      speechError,
      unread,
      contextLabel,
      deviceId: workspace.selectedDeviceId,
      eventId: workspace.selectedEventId,
      send,
      speak,
      stopSpeaking,
      notify,
      cancel,
    }),
    [
      open,
      setOpen,
      toggle,
      messages,
      busy,
      emotion,
      talking,
      speakingId,
      speechError,
      unread,
      contextLabel,
      workspace.selectedDeviceId,
      workspace.selectedEventId,
      send,
      speak,
      stopSpeaking,
      notify,
      cancel,
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

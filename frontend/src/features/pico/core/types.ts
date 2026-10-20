/** Pico 前端消息与后端结构化协议的类型。 */
export type PicoEmotion =
  | 'idle'
  | 'curious'
  | 'thinking'
  | 'search'
  | 'happy'
  | 'alert'
  | 'confused'
  | 'talking'

export type PicoActionType =
  | 'open_device'
  | 'open_event'
  | 'open_report'
  | 'switch_workspace_view'

/** Explicit business state only: no DOM, input contents or authentication data. */
export interface PicoContextSnapshot {
  area: string
  route: string
  device_id?: string
  event_id?: number
  active_tab?: string
  visible_section?: string
  context_revision: number
}

export interface PicoResolvedContext {
  device_id?: string
  event_id?: number
}

export interface PicoReference {
  kind: 'device' | 'event' | 'report' | 'telemetry' | 'research' | 'knowledge'
  id: string
  label: string
  source: string
  observed_at?: string | null
}

export interface PicoAction {
  type: PicoActionType
  label: string
  target: string
  params: Record<string, unknown>
}

export interface PicoMeta {
  data_status: 'current' | 'stale' | 'missing'
  source_kind: 'real' | 'simulated' | 'offline' | 'unknown'
  degraded: boolean
  llm: 'live' | 'unconfigured' | 'fallback'
}

export interface PicoChatResponse {
  version: string
  message_id: string
  request_id: string
  type: 'answer' | 'error'
  text: string
  emotion: PicoEmotion
  references: PicoReference[]
  actions: PicoAction[]
  meta: PicoMeta
  context_revision?: number | null
  resolved_context?: PicoResolvedContext | null
}

export interface PicoMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  emotion?: PicoEmotion
  references?: PicoReference[]
  actions?: PicoAction[]
  meta?: PicoMeta
  contextLabel?: string
}

export interface PicoNotification {
  title?: string
  text: string
  severity?: 'info' | 'warning' | 'critical'
  eventId?: number
  deviceId?: string
}

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

export interface PicoDeviceFields {
  id?: string
  name?: string
  device_type?: 'pump' | 'motor' | 'compressor'
  health_score?: number
  status?: 'healthy' | 'degraded' | 'fault' | 'offline'
}

type PicoNavigateAction = { type: 'navigate'; action_id: string } & (
  | { route_id: 'factory' | 'device_management'; params: Record<string, never> }
  | { route_id: 'records'; params: { device_id?: string } }
  | { route_id: 'tools'; params: { tool?: 'diagnosis' | 'events' | 'simulation' | 'vision' | 'pico' | 'evaluation' | 'settings'; device_id?: string } }
  | { route_id: 'research'; params: { topic_id?: string; point_id?: string } }
  | { route_id: 'device_detail'; params: { device_id: string; tab?: 'realtime' | 'history' | 'latent' | 'acoustic' | 'phm' | 'events' | 'threshold' } }
  | { route_id: 'event_detail' | 'report'; params: { event_id: number; device_id?: string } }
)

export type PicoUiAction =
  | PicoNavigateAction
  | { type: 'set_theme'; action_id: string; theme: 'light' | 'dark' }
  | { type: 'prefill_device_form'; action_id: string; mode: 'create' | 'edit'; device_id?: string; fields: PicoDeviceFields }

export interface PicoActionResult {
  action_id: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rejected'
  message: string
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
  ui_actions?: PicoUiAction[]
  tool_trace?: Array<{ tool: string; status: string; duration_ms: number; reference_ids: string[] }>
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
  actionResults?: PicoActionResult[]
}

export interface PicoNotification {
  title?: string
  text: string
  severity?: 'info' | 'warning' | 'critical'
  eventId?: number
  deviceId?: string
}

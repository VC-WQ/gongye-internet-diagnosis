import api from '../../../services/api'
import type { PicoChatResponse, PicoContextSnapshot, PicoResolvedContext } from '../core/types'

export interface PicoChatPayload {
  message: string
  page?: string
  device_id?: string
  event_id?: number
  tab?: string
  context?: PicoContextSnapshot
  conversation_focus?: PicoResolvedContext
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface PicoCapabilities {
  version: string
  llm_available: boolean
  tools: string[]
  limits: Record<string, number>
  write_tools: string[]
}

export const getPicoCapabilities = () =>
  api.get<PicoCapabilities>('/pico/capabilities').then((r) => r.data)

export const postPicoChat = (payload: PicoChatPayload, signal?: AbortSignal) =>
  api
    .post<PicoChatResponse>('/pico/chat', payload, { signal, timeout: 18000 })
    .then((r) => r.data)

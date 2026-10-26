import api from '../../../services/api'
import type { PicoChatResponse, PicoContextSnapshot, PicoResolvedContext, PicoTaskResponse, PicoActionResult } from '../core/types'
import type { PicoPageSnapshot } from '../core/pageSnapshot'

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
    // Planner (7s) + answer (10s), both without retry, plus bounded local queries.
    .post<PicoChatResponse>('/pico/chat', payload, { signal, timeout: 25000 })
    .then((r) => r.data)

export const startPicoTask = (payload: PicoChatPayload & { page_snapshot: PicoPageSnapshot; client_task_id: string }, signal: AbortSignal) =>
  api.post<PicoTaskResponse>('/pico/tasks', payload, { signal, timeout: 20000 }).then(r => r.data)

export const continuePicoTask = (id: string, payload: { context: PicoContextSnapshot; page_snapshot: PicoPageSnapshot; expected_step: number; observation?: PicoActionResult }, signal: AbortSignal) =>
  api.post<PicoTaskResponse>(`/pico/tasks/${encodeURIComponent(id)}/continue`, payload, { signal, timeout: 20000 }).then(r => r.data)

export const cancelPicoTask = (id: string) => api.delete(`/pico/tasks/${encodeURIComponent(id)}`, { timeout: 3000 }).catch(() => undefined)

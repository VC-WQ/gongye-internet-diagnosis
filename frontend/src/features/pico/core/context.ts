import type { PicoContextSnapshot, PicoResolvedContext } from './types'

const DETAIL_TABS = ['realtime', 'history', 'latent', 'acoustic', 'phm', 'events', 'threshold']

interface ContextInput {
  area: string
  pathname: string
  search: string
  deviceId?: string
  eventId?: number
  contextRevision: number
}

/** A business snapshot, never a scrape of the page or a copy of arbitrary query inputs. */
export function buildPicoContext(input: ContextInput): PicoContextSnapshot {
  const query = new URLSearchParams(input.search)
  const route = input.pathname
  let activeTab: string | undefined
  let visibleSection: string | undefined
  if (/^\/manage\/devices(?:\/|$)/.test(route)) {
    const detail = query.get('detail') ?? 'realtime'
    activeTab = DETAIL_TABS.includes(detail) ? detail : 'realtime'
    visibleSection = 'device_detail'
  } else if (route === '/tools/events') {
    visibleSection = query.get('section') === 'report' ? 'report' : 'event'
    activeTab = visibleSection === 'report' ? undefined : query.get('tab') === 'timeline' ? 'timeline' : 'resolution'
  } else if (route.startsWith('/tools/')) {
    visibleSection = route.split('/')[2]
  } else if (/^\/manage\/records(?:\/|$)/.test(route)) {
    visibleSection = input.eventId ? 'record_detail' : 'records'
  } else if (/^\/research(?:\/|$)/.test(route)) {
    const [, , topic, point] = route.split('/')
    visibleSection = topic ? `research:${topic}` : 'research_overview'
    activeTab = point
  } else if (route === '/dashboard') {
    visibleSection = 'factory_overview'
  }
  return {
    area: input.area,
    route,
    ...(input.deviceId ? { device_id: input.deviceId } : {}),
    ...(Number.isSafeInteger(input.eventId) && Number(input.eventId) > 0 ? { event_id: input.eventId } : {}),
    ...(activeTab ? { active_tab: activeTab } : {}),
    ...(visibleSection ? { visible_section: visibleSection } : {}),
    context_revision: input.contextRevision,
  }
}

/** Fixed fields make equality independent of object insertion order. */
export function picoContextFingerprint(context: PicoContextSnapshot): string {
  return JSON.stringify([
    context.area, context.route, context.device_id ?? null, context.event_id ?? null,
    context.active_tab ?? null, context.visible_section ?? null, context.context_revision,
  ])
}

export function withPicoOverride(
  context: PicoContextSnapshot,
  override?: PicoResolvedContext,
): PicoContextSnapshot {
  if (!override) return context
  const next = { ...context }
  if (override.device_id) {
    next.device_id = override.device_id
    // A newly named device must not inherit an event belonging to the old one.
    if (override.device_id !== context.device_id && override.event_id == null) delete next.event_id
  }
  if (override.event_id != null) next.event_id = override.event_id
  return next
}

export function validatedPicoFocus(value?: PicoResolvedContext | null): PicoResolvedContext | undefined {
  if (!value) return undefined
  const device = typeof value.device_id === 'string' && value.device_id.length > 0 && value.device_id.length <= 64
    ? value.device_id : undefined
  const event = Number.isSafeInteger(value.event_id) && Number(value.event_id) > 0 ? value.event_id : undefined
  return device || event ? { ...(device ? { device_id: device } : {}), ...(event ? { event_id: event } : {}) } : undefined
}

/** Abort is cooperative, so a late response must also pass this commit gate. */
export function canCommitPicoResponse(input: {
  requestId: number
  currentRequestId: number
  fingerprint: string
  currentFingerprint: string
  revision: number
  responseRevision?: number | null
}): boolean {
  return input.requestId === input.currentRequestId &&
    input.fingerprint === input.currentFingerprint &&
    (input.responseRevision == null || input.responseRevision === input.revision)
}

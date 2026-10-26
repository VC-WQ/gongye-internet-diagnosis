import type { PicoContextSnapshot } from './types'
import { RESEARCH_TOPICS } from '../../about/research'
import { TOOL_LABELS } from '../../../services/workspaceMode'

export interface PicoPageEntity {
  kind: 'device' | 'event' | 'report' | 'research'
  id: string
  name: string
  selected: boolean
}
export interface PicoPageDatum {
  label: string
  value: string | number | null
  unit?: string
  entity_id?: string
  observed_at?: string
  source: string
}
export interface PicoPageSnapshot {
  version: 1
  page_id: string
  page_title: string
  route: string
  context_revision: number
  state: 'loading' | 'ready' | 'error' | 'empty'
  visible_sections: Array<{ id: string; title: string; text?: string }>
  entities: PicoPageEntity[]
  visible_data: PicoPageDatum[]
  filters: Record<string, string | number>
  selection: { device_id?: string; event_id?: number }
  available_actions: string[]
}
export interface PicoPageAdapter {
  route: string
  search: string
  state: PicoPageSnapshot['state']
  entities?: PicoPageEntity[]
  visible_data?: PicoPageDatum[]
}

const TOOLS: Record<string, string> = TOOL_LABELS
const FILTER_KEYS = ['status', 'q', 'page', 'detail', 'channel', 'section', 'sort', 'device']
const BASE_ACTIONS = ['navigate', 'set_theme']
const clean = (value: string, limit: number) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit)

/** Code-defined meanings, restricted to routes that the application actually renders. */
export function describePicoPage(route: string): { id: string; title: string; actions: string[] } {
  if (route === '/dashboard') return { id: 'factory_overview', title: '工厂总览', actions: [...BASE_ACTIONS, 'set_factory_filter', 'select_factory_device'] }
  if (/^\/manage\/devices(?:\/[^/]+)?$/.test(route)) return { id: 'device_detail', title: '设备详情', actions: BASE_ACTIONS }
  if (route === '/manage/records') return { id: 'records', title: '诊断记录', actions: BASE_ACTIONS }
  if (/^\/manage\/records\/\d+$/.test(route)) return { id: 'record_detail', title: '诊断记录详情', actions: BASE_ACTIONS }
  if (route === '/tools') return { id: 'tools', title: '工具', actions: BASE_ACTIONS }
  if (/^\/tools\/[^/]+$/.test(route) && TOOLS[route.split('/')[2]]) return { id: `tool_${route.split('/')[2]}`, title: TOOLS[route.split('/')[2]], actions: BASE_ACTIONS }
  if (/^\/research(?:\/[^/]+){0,2}$/.test(route)) {
    const [, , topicId, pointId] = route.split('/')
    const topic = RESEARCH_TOPICS.find(item => item.id === topicId)
    if (!topicId || (topic && (!pointId || topic.points.some(point => point.id === pointId)))) return { id: 'research', title: '研究', actions: BASE_ACTIONS }
  }
  if (/^\/admin\/(devices|users|records)$/.test(route)) return { id: `admin_${route.split('/')[2]}`, title: { devices: '设备管理', users: '用户管理', records: '诊断记录管理' }[route.split('/')[2]]!, actions: [...BASE_ACTIONS, ...(route === '/admin/devices' ? ['prefill_device_form'] : [])] }
  return { id: 'unknown', title: '当前页面', actions: [] }
}

/** One active adapter. A stale page's cleanup cannot remove its successor. */
let adapter: { owner: symbol; read: () => PicoPageAdapter } | undefined
export function registerPicoPageAdapter(read: () => PicoPageAdapter): () => void {
  const owner = Symbol('page')
  adapter = { owner, read }
  return () => { if (adapter?.owner === owner) adapter = undefined }
}

export function isPicoVisible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], [inert], [data-pico-exclude], form')) return false
  const box = element.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) return false
  let node: Element | null = element
  while (node) {
    const style = getComputedStyle(node)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false
    node = node.parentElement
  }
  return true
}

/** Whitelisted output nodes only. Never read input values, raw HTML or arbitrary containers. */
export function readPicoVisibleSections(root: HTMLElement | null): PicoPageSnapshot['visible_sections'] {
  if (!root) return []
  const nodes = [...root.querySelectorAll('h1, h2, h3, [data-pico-summary], table, .ant-descriptions, .ant-statistic'), ...document.querySelectorAll('[data-pico-output="research-details"]')]
  return nodes
    .filter(isPicoVisible).slice(0, 12).map((node, index) => {
      // Clone text leaves, not the output subtree. Skip hidden rows and all form/control content.
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      const parts: string[] = []
      let textNode: Node | null
      while ((textNode = walker.nextNode())) {
        const parent = textNode.parentElement
        if (!parent || parent.closest('input, textarea, select, script, style, button, [role="textbox"], [contenteditable], [data-pico-exclude]') || !isPicoVisible(parent)) continue
        const text = textNode.textContent?.trim()
        if (text) parts.push(text)
        if (parts.join(' ').length > 500) break
      }
      const labelled = [node, ...node.querySelectorAll('[aria-label]')].filter(isPicoVisible)
        .filter(item => !item.closest('input, textarea, select, button, [role="textbox"], [contenteditable]'))
        .map(item => item.getAttribute('aria-label')).filter(Boolean).slice(0, 5).join(' ')
      const text = clean(parts.join(' '), 500)
      const title = clean(node.getAttribute('aria-label') || node.getAttribute('data-pico-summary') || (/^H[123]$/.test(node.tagName) ? labelled || text || '业务标题' : node.tagName === 'TABLE' ? '当前可见表格' : '当前业务指标'), 100)
      return { id: node.getAttribute('data-pico-summary') || `visible_${index}`, title, text }
    })
}

export function buildPicoPageSnapshot(context: PicoContextSnapshot, search: string, root: HTMLElement | null = document.getElementById('main-content')): PicoPageSnapshot {
  const page = describePicoPage(context.route)
  const candidate = adapter?.read()
  const current = candidate?.route === context.route && new URLSearchParams(candidate.search).toString() === new URLSearchParams(search).toString() ? candidate : undefined
  const filters: Record<string, string | number> = {}
  const query = new URLSearchParams(search)
  FILTER_KEYS.forEach(key => { const value = query.get(key); if (value) filters[key] = key === 'page' ? Math.max(1, Math.min(100000, Number(value) || 1)) : clean(value, 80) })
  const snapshot: PicoPageSnapshot = {
    version: 1, page_id: page.id, page_title: page.title, route: context.route,
    context_revision: context.context_revision,
    state: current?.state ?? (!root || root.dataset.routeReady !== 'true' || root.querySelector('[data-route-preparing="true"]') ? 'loading' : 'ready'),
    visible_sections: readPicoVisibleSections(root),
    entities: (current?.entities ?? []).filter(entity => {
      const markers = Array.from(root?.querySelectorAll('[data-pico-entity-id]') ?? []).filter(node => node.getAttribute('data-pico-entity-id') === entity.id)
      return !markers.length || markers.some(isPicoVisible)
    }).slice(0, 20).map(entity => ({ ...entity, id: clean(entity.id, 64), name: clean(entity.name, 128) })),
    visible_data: (current?.visible_data ?? []).slice(0, 40).map(datum => ({ ...datum, source: clean(datum.source, 100), label: clean(datum.label, 80), value: typeof datum.value === 'string' ? clean(datum.value, 300) : typeof datum.value === 'number' && !Number.isFinite(datum.value) ? null : datum.value })),
    filters,
    selection: { ...(context.device_id ? { device_id: context.device_id } : {}), ...(context.event_id ? { event_id: context.event_id } : {}) },
    available_actions: page.actions,
  }
  snapshot.visible_data = snapshot.visible_data.filter(datum => !datum.entity_id || !current?.entities?.some(entity => entity.id === datum.entity_id) || snapshot.entities.some(entity => entity.id === datum.entity_id))
  // Bound UTF-16 size before transport. Keep selection and page identity even on large tables.
  while (JSON.stringify(snapshot).length > 15000 && snapshot.visible_sections.length) snapshot.visible_sections.pop()
  while (JSON.stringify(snapshot).length > 15000 && snapshot.visible_data.length) snapshot.visible_data.pop()
  while (JSON.stringify(snapshot).length > 15000 && snapshot.entities.length) snapshot.entities.pop()
  return snapshot
}

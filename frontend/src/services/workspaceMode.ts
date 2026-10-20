/**
 * V2.2 工作空间 URL 契约。
 *
 * 四个业务域：工厂 / 工具 / 管理 / 关于。
 * 工厂只使用 /dashboard 一个地址；设备、事件、面板、筛选全部是看板内部状态，
 * 不再存在六个平级视图。旧地址只做一次单向迁移，不参与渲染。
 */

export const AREAS = ['factory', 'tools', 'admin', 'about'] as const
export type Area = (typeof AREAS)[number]

export const FACTORY_PANELS = [
  'none',
  'device',
  'monitor',
  'diagnosis',
  'events',
  'report',
] as const
export type FactoryPanel = (typeof FACTORY_PANELS)[number]

export const STATUS_FILTERS = [
  'all',
  'healthy',
  'degraded',
  'fault',
  'offline',
] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

export const DETAIL_TABS = [
  'realtime',
  'history',
  'latent',
  'acoustic',
  'phm',
  'events',
  'threshold',
] as const
export type DetailTab = (typeof DETAIL_TABS)[number]

export const TOOLS = [
  'simulation',
  'vision',
  'pico',
  'evaluation',
  'settings',
] as const
export type ToolKey = (typeof TOOLS)[number]

export const CHANNELS = [
  'vibration',
  'temperature',
  'current',
  'pressure',
  'speed',
  'acoustic',
] as const

export const PANEL_LABELS: Record<FactoryPanel, string> = {
  none: '工厂总览',
  device: '设备分析',
  monitor: '实时监测',
  diagnosis: '智能诊断',
  events: '事件处置',
  report: '诊断报告',
}

export const DETAIL_LABELS: Record<DetailTab, string> = {
  realtime: '实时监测',
  history: '健康历史',
  latent: '孪生隐状态',
  acoustic: '声学频谱',
  phm: '孪生研究',
  events: '历史事件',
  threshold: '阈值建议',
}

export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: '全部',
  healthy: '正常',
  degraded: '退化',
  fault: '告警',
  offline: '离线',
}

export const TOOL_LABELS: Record<ToolKey, string> = {
  simulation: '仿真测试',
  vision: '缺陷检测',
  pico: '数字伴侣',
  evaluation: '系统自评',
  settings: '系统设置',
}

const FACTORY_QUERY_KEYS = new Set([
  'device',
  'event',
  'status',
  'panel',
  'detail',
  'tab',
  'q',
  'page',
  'channel',
  'evidence',
])

/** 旧视图 → 工厂面板。旧 view 只在这里出现一次，之后不再驱动界面。 */
const LEGACY_VIEW_PANEL: Record<string, FactoryPanel> = {
  scene: 'none',
  devices: 'none',
  device: 'device',
  diagnose: 'diagnosis',
  events: 'events',
  reports: 'report',
}

const LEGACY_PATHS: Record<string, (search: URLSearchParams) => string> = {
  '/': () => '/dashboard',
  '/devices': (source) => factoryPathFrom(source, { panel: 'none' }),
  '/diagnose': (source) => legacyDiagnosePath(source),
  '/events': (source) => {
    const query = new URLSearchParams(source)
    query.delete('view')
    return factoryPathFrom(query, { panel: 'events' })
  },
  '/reports': (source) => factoryPathFrom(source, { panel: 'report' }),
  '/lab': () => '/about/research/signal',
  '/ops': (source) => legacyOpsPath(source),
}

export function normalizeStatus(value: string | null | undefined): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter)
    ? (value as StatusFilter)
    : 'all'
}

export function normalizePanel(value: string | null | undefined): FactoryPanel {
  return FACTORY_PANELS.includes(value as FactoryPanel)
    ? (value as FactoryPanel)
    : 'none'
}

export function normalizeDetail(value: string | null | undefined): DetailTab {
  return DETAIL_TABS.includes(value as DetailTab)
    ? (value as DetailTab)
    : 'realtime'
}

export function normalizeTool(value: string | undefined): ToolKey | undefined {
  return TOOLS.includes(value as ToolKey) ? (value as ToolKey) : undefined
}

export function normalizeChannel(value: string | null | undefined): string | undefined {
  if (!value || !CHANNELS.includes(value as (typeof CHANNELS)[number])) return undefined
  return value
}

export function safeDecode(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value)
    return decoded && !/[\u0000-\u001f]/.test(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function positiveInteger(value: string | null): string | undefined {
  return value && /^[1-9]\d*$/.test(value) ? value : undefined
}

function clean(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** 只保留仍有业务意义的参数；非法值直接丢弃而不是带到 UI。 */
function factoryPathFrom(
  source: URLSearchParams,
  overrides: { panel?: FactoryPanel } = {},
): string {
  const device = source.get('device')
  const event = positiveInteger(source.get('event'))
  const status = normalizeStatus(source.get('status'))
  const panel = overrides.panel ?? normalizePanel(source.get('panel'))
  const rawDetail = source.get('detail') ?? source.get('tab')
  const detail = normalizeDetail(rawDetail)
  const tab = source.get('tab')
  const q = clean(source.get('q'))
  const page = positiveInteger(source.get('page'))
  const channel = normalizeChannel(source.get('channel'))
  const evidence = source.get('evidence')
  const query = new URLSearchParams()
  if (device) query.set('device', device)
  if (event) query.set('event', event)
  if (status !== 'all') query.set('status', status)
  if (panel !== 'none') query.set('panel', panel)
  if ((panel === 'device' || panel === 'monitor') && rawDetail && detail)
    query.set('detail', detail)
  // 事件工作区内部子视图只接受两种；其他旧 tab 不保留。
  if (panel === 'events' && (tab === 'timeline' || tab === 'resolution'))
    query.set('tab', tab)
  if (panel === 'report' && (tab === 'flash' || tab === 'event')) query.set('tab', tab)
  if (q) query.set('q', q)
  if (page) query.set('page', page)
  if (channel) query.set('channel', channel)
  if (evidence) query.set('evidence', evidence)
  return `/dashboard${query.size ? `?${query}` : ''}`
}

function legacyDiagnosePath(source: URLSearchParams): string {
  const tab = source.get('tab')
  if (tab === 'report') return factoryPathFrom(source, { panel: 'report' })
  if (tab === 'timeline' || tab === 'trajectory') {
    const query = new URLSearchParams(source)
    query.set('tab', 'timeline')
    return factoryPathFrom(query, { panel: 'events' })
  }
  return factoryPathFrom(source, { panel: 'diagnosis' })
}

function legacyOpsPath(source: URLSearchParams): string {
  const tab = source.get('tab')
  if (tab === 'eval') return '/tools/evaluation'
  if (tab === 'threshold') return '/tools/settings'
  return '/about/research/mechanism'
}

/** 旧 /dashboard?view=... 与旧平级地址的单向迁移。 */
export function legacyRedirect(
  pathname: string,
  search = '',
): string | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  const source = new URLSearchParams(search)

  if (path === '/dashboard') {
    const view = source.get('view')
    if (view && view in LEGACY_VIEW_PANEL) {
      // 设备列表曾把仿真测试塞进 tab=inject，仿真现在只有工具区一个入口。
      if (view === 'devices' && source.get('tab') === 'inject') {
        const query = new URLSearchParams()
        const device = source.get('device')
        if (device) query.set('device', device)
        return `/tools/simulation${query.size ? `?${query}` : ''}`
      }
      const query = new URLSearchParams(source)
      query.delete('view')
      query.set('panel', LEGACY_VIEW_PANEL[view])
      return factoryPathFrom(query, {
        panel: LEGACY_VIEW_PANEL[view],
      })
    }
    if (view) {
      const query = new URLSearchParams(source)
      query.delete('view')
      query.delete('tab')
      return factoryPathFrom(query, { panel: 'none' })
    }
    // 已经是 canonical 形态时不重定向，避免循环。
    const canonical = factoryPathFrom(source)
    const current = `/dashboard${search ? `?${new URLSearchParams(search)}` : ''}`
    return canonical === current ? undefined : canonical
  }

  if (path.startsWith('/device/')) {
    const id = safeDecode(path.split('/')[2] ?? '')
    const query = new URLSearchParams(source)
    if (id) query.set('device', id)
    else query.delete('device')
    return factoryPathFrom(query, { panel: 'device' })
  }

  const map = LEGACY_PATHS[path]
  if (map) return map(source)

  if (path === '/tools') return '/tools'
  if (path.startsWith('/tools/')) {
    const tool = normalizeTool(path.split('/')[2])
    return tool ? `/tools/${tool}` : '/tools'
  }
  if (path === '/about') return '/about'
  if (path.startsWith('/about/')) return path
  if (path === '/admin') return '/admin/users'
  if (path.startsWith('/admin/')) {
    const page = path.split('/')[2]
    return ['users', 'devices', 'records'].includes(page)
      ? `/admin/${page}`
      : '/admin/users'
  }
  return undefined
}

export function areaFromPath(pathname: string): Area {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/dashboard') return 'factory'
  if (path === '/tools' || path.startsWith('/tools/')) return 'tools'
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin'
  if (path === '/about' || path.startsWith('/about/')) return 'about'
  return 'factory'
}

export function factoryState(search: string) {
  const params = new URLSearchParams(search)
  return {
    deviceId: params.get('device') ?? undefined,
    eventId: Number(params.get('event')) || undefined,
    statusFilter: normalizeStatus(params.get('status')),
    panel: normalizePanel(params.get('panel')),
    detailTab: normalizeDetail(params.get('detail')),
    subview: params.get('tab') ?? undefined,
    keyword: params.get('q') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
    channel: params.get('channel') ?? undefined,
    evidence: params.get('evidence') ?? undefined,
  }
}

/** 生成工厂内部状态的 canonical 地址（供 UI 内部跳转复用）。 */
export function factoryPath(options: {
  device?: string
  event?: number
  status?: StatusFilter
  panel?: FactoryPanel
  detail?: DetailTab
  tab?: 'timeline' | 'resolution' | 'flash' | 'event'
  q?: string
  page?: number
  channel?: string
  evidence?: string
}): string {
  const search = new URLSearchParams()
  if (options.device) search.set('device', options.device)
  if (options.event) search.set('event', String(options.event))
  if (options.status && options.status !== 'all') search.set('status', options.status)
  if (options.panel && options.panel !== 'none') search.set('panel', options.panel)
  if (options.detail && (options.panel === 'device' || options.panel === 'monitor'))
    search.set('detail', options.detail)
  if (options.tab) search.set('tab', options.tab)
  if (options.q) search.set('q', options.q)
  if (options.page && options.page > 1) search.set('page', String(options.page))
  if (options.channel) search.set('channel', options.channel)
  if (options.evidence) search.set('evidence', options.evidence)
  return `/dashboard${search.size ? `?${search}` : ''}`
}

/** 上一级按信息层级，不按历史条数。返回 null 表示已在顶层。 */
export function upperLevelPath(pathname: string, search = ''): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/dashboard') {
    const state = factoryState(search)
    if (state.panel === 'none') return null
    return factoryPath({
      device: state.deviceId,
      event: state.eventId,
      status: state.statusFilter,
      q: state.keyword || undefined,
      channel: state.channel,
      page: state.page,
    })
  }
  if (path.startsWith('/tools')) return path === '/tools' ? '/dashboard' : '/tools'
  if (path.startsWith('/about')) {
    if (path === '/about') return '/dashboard'
    const segments = path.split('/').filter(Boolean)
    if (segments.length >= 4) return `/${segments.slice(0, 3).join('/')}`
    return '/about'
  }
  if (path.startsWith('/admin')) {
    return path === '/admin/users' ? '/dashboard' : '/admin/users'
  }
  return '/dashboard'
}

/** 兼容旧调用方：旧路径先迁移，新路径原样返回。 */
export function workspaceLink(
  path: string,
  device?: string,
  event?: number,
): string {
  const [pathname, search = ''] = path.split('?')
  const query = new URLSearchParams(search)
  if (device) query.set('device', device)
  if (event != null) query.set('event', String(event))
  return (
    legacyRedirect(pathname, query.toString()) ??
    `${pathname}${query.size ? `?${query}` : ''}`
  )
}

/** Pico 动作白名单只允许新的四域站内地址。 */
export function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020]/.test(path))
    return false
  try {
    if (/[\\\u0000-\u0020]/.test(decodeURIComponent(path))) return false
  } catch {
    return false
  }
  return /^\/(dashboard|tools|about)([/?#]|$)/.test(path) || path === '/'
}

export function isFactoryQueryKey(key: string): boolean {
  return FACTORY_QUERY_KEYS.has(key)
}

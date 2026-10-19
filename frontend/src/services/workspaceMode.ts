/** 工作空间 URL 契约。业务视图共享设备/事件身份，各自保留筛选和面板状态。 */
export const WORKSPACE_VIEWS = ['scene', 'devices', 'device', 'diagnose', 'events', 'reports'] as const
export type WorkspaceView = typeof WORKSPACE_VIEWS[number]
export type WorkspaceMode = 'overview' | Exclude<WorkspaceView, 'scene'> | 'lab' | 'ops' | 'admin' | 'unknown'
export const VIEW_LABELS: Record<WorkspaceView, string> = {
  scene: '工厂总览', devices: '设备浏览', device: '设备详情',
  diagnose: '智能诊断', events: '事件处置', reports: '报告与档案',
}
const LEGACY_VIEWS: Record<string, WorkspaceView> = {
  '/': 'scene', '/devices': 'devices', '/diagnose': 'diagnose',
  '/events': 'events', '/reports': 'reports',
}
const QUERY_KEYS = ['device', 'event', 'q', 'status', 'page', 'tab', 'channel'] as const

export function viewFromLocation(pathname: string, search = ''): WorkspaceView | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)
  if (path === '/dashboard') {
    const value = params.get('view')
    return WORKSPACE_VIEWS.includes(value as WorkspaceView) ? value as WorkspaceView : 'scene'
  }
  if (path.startsWith('/device/')) return 'device'
  if (path === '/diagnose') {
    if (params.get('tab') === 'report') return 'reports'
    if (['timeline', 'trajectory'].includes(params.get('tab') ?? '')) return 'events'
  }
  return LEGACY_VIEWS[path]
}

export function modeFromPath(pathname: string, search = ''): WorkspaceMode {
  const view = viewFromLocation(pathname, search)
  if (view) return view === 'scene' ? 'overview' : view
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/lab') return 'lab'
  if (path === '/ops') return 'ops'
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin'
  return 'unknown'
}

/** 旧链接仅迁移 URL，不挂载业务组件，因此不会重复提交诊断。 */
export function canonicalWorkspacePath(pathname: string, search = ''): string | undefined {
  const view = viewFromLocation(pathname, search)
  if (!view) return undefined
  const source = new URLSearchParams(search)
  const query = new URLSearchParams({ view })
  for (const key of QUERY_KEYS) {
    const value = source.get(key)
    if (value) query.set(key, value)
  }
  if (pathname.replace(/\/+$/, '').startsWith('/device/')) {
    try {
      const id = decodeURIComponent(pathname.split('/')[2] ?? '')
      if (id) query.set('device', id)
    } catch {
      query.delete('device')
    }
  }
  if (pathname.replace(/\/+$/, '') === '/diagnose') {
    if (source.get('tab') === 'report') query.delete('tab')
    if (['timeline', 'trajectory'].includes(source.get('tab') ?? '')) query.set('tab', 'timeline')
  }
  for (const numeric of ['event', 'page']) {
    if (query.has(numeric) && !/^[1-9]\d*$/.test(query.get(numeric)!)) query.delete(numeric)
  }
  return `/dashboard?${query}`
}

export function workspaceLink(path: string, device?: string, event?: number): string {
  const [pathname, search = ''] = path.split('?')
  const query = new URLSearchParams(search)
  if (device) query.set('device', device)
  if (event != null) query.set('event', String(event))
  return canonicalWorkspacePath(pathname, query.toString()) ?? `${pathname}${query.size ? `?${query}` : ''}`
}

/** 切换模式时只恢复目标视图的筛选，绝不恢复其过期的设备/事件身份。 */
export function transitionWorkspacePath(view: WorkspaceView, currentSearch: string, savedSearch = ''): string {
  const current = new URLSearchParams(currentSearch)
  const query = new URLSearchParams(savedSearch)
  query.set('view', view)
  for (const key of ['device', 'event']) {
    const value = current.get(key)
    if (value) query.set(key, value)
    else query.delete(key)
  }
  return canonicalWorkspacePath('/dashboard', query.toString())!
}

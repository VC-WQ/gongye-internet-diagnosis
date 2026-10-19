/** 路由 → 工作台模式的纯函数映射（可独立测试，不依赖 React）。 */
export type WorkspaceMode =
  | 'overview'
  | 'devices'
  | 'device'
  | 'diagnose'
  | 'events'
  | 'reports'
  | 'lab'
  | 'ops'
  | 'admin'
  | 'unknown'

export function modeFromPath(pathname: string): WorkspaceMode {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/' || path === '/dashboard') return 'overview'
  if (path === '/devices') return 'devices'
  if (path.startsWith('/device/')) return 'device'
  if (path === '/diagnose') return 'diagnose'
  if (path === '/events') return 'events'
  if (path === '/reports') return 'reports'
  if (path === '/lab') return 'lab'
  if (path === '/ops') return 'ops'
  if (path.startsWith('/admin')) return 'admin'
  return 'unknown'
}

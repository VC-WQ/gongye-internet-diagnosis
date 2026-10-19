import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Alert,
  Button,
  ConfigProvider,
  Dropdown,
  Result,
  Skeleton,
  theme as antdTheme,
} from 'antd'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom'
import { RealtimeProvider } from './services/realtime'
import { WorkspaceProvider, useWorkspace } from './services/workspace'
import { PicoProvider } from './features/pico/core/PicoProvider'
import PicoDock from './features/pico/ui/PicoDock'
import { getMe, type AuthUser } from './services/api'
import { useResource } from './hooks/useResource'
import { canonicalWorkspacePath, viewFromLocation, VIEW_LABELS, WORKSPACE_VIEWS, workspaceLink, transitionWorkspacePath, type WorkspaceView } from './services/workspaceMode'
import { useDeviceCatalog } from './services/realtime'
import { LoadState } from './components/BusinessUI'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const DeviceDetail = lazy(() => import('./pages/DeviceDetail'))
const DiagnoseWorkbench = lazy(() => import('./pages/DiagnoseWorkbench'))
const DeviceCenter = lazy(() => import('./pages/DeviceCenter'))
const EventCenter = lazy(() => import('./pages/EventCenter'))
const ReportCenter = lazy(() => import('./pages/ReportCenter'))
const ModelLab = lazy(() => import('./pages/ModelLab'))
const SystemOps = lazy(() => import('./pages/SystemOps'))
const Login = lazy(() => import('./pages/Login'))
const UserManagement = lazy(() => import('./pages/UserManagement'))
const DeviceManagement = lazy(() => import('./pages/DeviceManagement'))
const RecordManagement = lazy(() => import('./pages/RecordManagement'))

const ADMIN = [
  { key: '/admin/users', label: '用户管理' },
  { key: '/admin/devices', label: '设备管理' },
  { key: '/admin/records', label: '诊断记录管理' },
]
type UiTheme = 'light' | 'dark'

function readTheme(): UiTheme {
  try {
    return localStorage.getItem('ui:theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export const productTheme = {
  token: {
    colorPrimary: '#c13d46',
    colorInfo: '#376c95',
    colorSuccess: '#348875',
    colorWarning: '#aa751f',
    colorError: '#c13d46',
    colorBgLayout: '#f3f4f6',
    colorBgContainer: '#ffffff',
    colorText: '#202631',
    colorTextSecondary: '#697381',
    colorBorder: '#dce0e6',
    colorBorderSecondary: '#e9ecf0',
    borderRadius: 8,
    controlHeight: 36,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  components: {
    Button: {
      borderRadius: 0,
      borderRadiusLG: 0,
      borderRadiusSM: 0,
      defaultShadow: 'none',
      primaryShadow: 'none',
    },
    Table: { headerBg: '#f7f8fa', cellPaddingBlock: 15 },
    Card: { headerFontSize: 15 },
    Tabs: { horizontalItemGutter: 28 },
  },
}

/** 深色主题只覆盖语义 token，品牌主色与按钮直角规则保持不变。 */
const darkThemeOverrides = {
  ...productTheme,
  token: {
    ...productTheme.token,
    colorBgLayout: '#0c141c',
    colorBgContainer: '#131e28',
    colorBgElevated: '#182532',
    colorText: '#e6eef5',
    colorTextSecondary: '#93a5b5',
    colorBorder: 'rgba(190, 220, 240, 0.14)',
    colorBorderSecondary: 'rgba(190, 220, 240, 0.1)',
  },
  components: {
    ...productTheme.components,
    Table: { headerBg: '#1b2a37', cellPaddingBlock: 15 },
  },
}
class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <Result
          status="error"
          title="页面暂不可用"
          extra={
            <Button onClick={() => window.location.reload()}>重新加载</Button>
          }
        />
      )
    return this.props.children
  }
}
function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  if (!localStorage.getItem('token'))
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: location.pathname + location.search }}
      />
    )
  return <>{children}</>
}
function MainLayout({
  uiTheme,
  onToggleTheme,
}: {
  uiTheme: UiTheme
  onToggleTheme: () => void
}) {
  const account = useResource('account', getMe)
  if (!account.data)
    return (
      <div className="auth-loading">
        <LoadState
          loading={account.loading}
          error={account.error}
          onRetry={account.refresh}
        />
      </div>
    )
  return (
    <RealtimeProvider>
      <WorkspaceProvider>
        <PicoProvider>
          <Workspace
            user={account.data}
            uiTheme={uiTheme}
            onToggleTheme={onToggleTheme}
          />
        </PicoProvider>
      </WorkspaceProvider>
    </RealtimeProvider>
  )
}
function Workspace({
  user,
  uiTheme,
  onToggleTheme,
}: {
  user: AuthUser
  uiTheme: UiTheme
  onToggleTheme: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const workspace = useWorkspace()
  const catalog = useDeviceCatalog()
  const view = viewFromLocation(location.pathname, location.search)
  const dashboard = view === 'scene'
  const canonical = canonicalWorkspacePath(location.pathname, location.search)
  const device = workspace.selectedDeviceId
  const event = workspace.selectedEventId
  const chosen = catalog.data?.find((item) => item.id === device)
  const title = view ? VIEW_LABELS[view] : location.pathname === '/lab' ? '算法实验室'
    : location.pathname === '/ops' ? '系统运维'
    : ADMIN.find((item) => item.key === location.pathname)?.label ?? '页面未找到'
  const maxIndex = useRef(Number(window.history.state?.workspaceMax ?? window.history.state?.idx ?? 0))
  const scroll = useRef<Record<string, number>>({})
  const idx = Number(window.history.state?.idx ?? 0)
  useEffect(() => {
    if (navigationType === 'PUSH') maxIndex.current = idx
    else maxIndex.current = Math.max(maxIndex.current, idx)
    window.history.replaceState({ ...window.history.state, workspaceMax: maxIndex.current }, '')
    if (device) sessionStorage.setItem('workspace:device', device)
    else sessionStorage.removeItem('workspace:device')
    const key = view ? `workspace:view:${view}` : `workspace:path:${location.pathname}`
    sessionStorage.setItem(key, location.pathname + location.search)
    document.title = `${title} · 工业设备智能诊断平台`
  }, [location, navigationType, idx, device, title, view])
  useLayoutEffect(() => {
    const key = location.key
    const storageKey = `workspace:scroll:${location.pathname}${location.search}`
    const target = scroll.current[key] ?? (Number(sessionStorage.getItem(storageKey)) || 0)
    let restoring = target > 0
    let unlock: ReturnType<typeof setTimeout> | undefined
    let observer: ResizeObserver | undefined
    const stopRestoring = () => {
      restoring = false
      observer?.disconnect()
      if (unlock) clearTimeout(unlock)
    }
    const restore = () => {
      if (!restoring) return
      if (document.documentElement.scrollHeight - window.innerHeight >= target) {
        window.scrollTo(0, target)
        stopRestoring()
      }
    }
    observer = new ResizeObserver(restore)
    const content = document.getElementById('main-content')
    if (content && restoring) observer.observe(content)
    if (restoring) unlock = setTimeout(() => {
      restoring = false
      observer?.disconnect()
      window.scrollTo(0, Math.min(target, document.documentElement.scrollHeight))
    }, 1500)
    const frame = requestAnimationFrame(() => {
      if (restoring) restore()
      else window.scrollTo(0, 0)
    })
    const save = () => {
      if (!restoring) {
        scroll.current[key] = window.scrollY
        sessionStorage.setItem(storageKey, String(window.scrollY))
      }
    }
    window.addEventListener('scroll', save, { passive: true })
    window.addEventListener('wheel', stopRestoring, { passive: true })
    window.addEventListener('touchstart', stopRestoring, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      if (unlock) clearTimeout(unlock)
      window.removeEventListener('scroll', save)
      window.removeEventListener('wheel', stopRestoring)
      window.removeEventListener('touchstart', stopRestoring)
    }
  }, [location.key])
  const goView = (next: WorkspaceView) => {
    // 筛选/分页/子面板只属于自己的模式；设备和事件是跨模式共享身份。
    const saved = sessionStorage.getItem(`workspace:view:${next}`)
    navigate(transitionWorkspacePath(next, location.search, saved?.split('?')[1]), {
      state: { returnTo: location.pathname + location.search },
    })
  }
  const goTool = (path: string) => navigate(workspaceLink(path, device, event), {
    state: { returnTo: location.pathname + location.search },
  })
  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith('workspace:') || key.startsWith('factory:'))
      .forEach((key) => sessionStorage.removeItem(key))
    navigate('/login', { replace: true })
  }
  const adminPage = (node: ReactNode) => user.role === 'admin' ? node : <Result status="403" title="没有管理权限" />
  const content = view === 'scene' ? <Dashboard />
    : view === 'devices' ? <DeviceCenter />
    : view === 'device' ? device ? <DeviceDetail /> : <Result title="先选择一台设备" extra={<Button onClick={() => goView('devices')}>浏览设备</Button>} />
    : view === 'diagnose' ? <DiagnoseWorkbench />
    : view === 'events' ? <EventCenter />
    : view === 'reports' ? <ReportCenter /> : undefined
  if (canonical && canonical !== location.pathname + location.search)
    return <Navigate to={canonical} replace state={location.state} />
  return (
    <div className={`workspace ${dashboard ? 'workspace-overview' : ''}`}>
      <a href="#main-content" className="skip-link">跳到主要内容</a>
      <header className="workspace-header">
        <button className="brand" onClick={() => goView('scene')} aria-label="工业设备智能诊断平台，工作空间">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>工业设备<span className="brand-sub">智能诊断平台</span></span>
        </button>
        <div className="history-actions">
          <Button aria-label="后退" title="后退" disabled={idx === 0} onClick={() => navigate(-1)}>‹</Button>
          <Button aria-label="前进" title="前进" disabled={navigationType === 'PUSH' || idx >= maxIndex.current} onClick={() => navigate(1)}>›</Button>
        </div>
        <div className="workspace-location">
          <Dropdown trigger={['click']} menu={{
            selectedKeys: view ? [view] : [],
            items: WORKSPACE_VIEWS.map((key) => ({ key, label: VIEW_LABELS[key] })),
            onClick: ({ key }) => goView(key as WorkspaceView),
          }}>
            <Button type="text" className="workspace-mode-button" aria-label="工作空间模式" aria-haspopup="menu">
              <span className="workspace-location-root">工作空间 / </span>{title} <span aria-hidden>⌄</span>
            </Button>
          </Dropdown>
          {device && <span className="workspace-device-context" title={device}>{chosen?.name ?? device}</span>}
        </div>
        <nav className="workspace-tools" aria-label="工具与管理">
          <Dropdown trigger={['click']} menu={{ items: [
            { type: 'group', label: '研究与验证', children: [
              { key: '/lab', label: '算法实验室' },
              ...(user.role === 'admin' ? [{ key: '/dashboard?view=devices&tab=inject', label: '仿真测试' }] : []),
            ] },
            { type: 'group', label: '运行维护', children: [
              { key: '/ops?tab=evolution', label: '运行闭环' },
              { key: '/ops?tab=eval', label: '系统自评' },
              { key: '/ops?tab=threshold', label: '阈值管理' },
            ] },
          ], onClick: ({ key }) => goTool(key) }}>
            <Button type="text" aria-label="研究与运维工具">工具 <span aria-hidden>⌄</span></Button>
          </Dropdown>
          {user.role === 'admin' && <Dropdown trigger={['click']} menu={{ items: ADMIN, onClick: ({ key }) => goTool(key) }}>
            <Button type="text" aria-label="管理功能">管理 <span aria-hidden>⌄</span></Button>
          </Dropdown>}
        </nav>
        <div className="account">
          <span className="account-avatar" title={user.username}>{user.username.slice(0, 1).toUpperCase()}</span>
          <Button type="text" onClick={onToggleTheme} aria-label="切换深浅主题">{uiTheme === 'dark' ? '浅色' : '深色'}</Button>
          <Dropdown trigger={['click']} menu={{ items: [{ key: 'logout', label: '退出登录' }], onClick: logout }}>
            <Button type="text" aria-label={`账户 ${user.username}`}>账户</Button>
          </Dropdown>
        </div>
      </header>
      <main id="main-content" className={dashboard ? 'overview-content' : 'business-content'} tabIndex={-1}>
        <PageBoundary key={view ?? location.pathname}>
          <Suspense fallback={<div className="loading-state"><Skeleton active paragraph={{ rows: 5 }} /></div>}>
            {view ? <div className="workspace-mode-content" data-workspace-view={view}>{content}</div> : <Routes>
              <Route path="/lab" element={<ModelLab />} />
              <Route path="/ops" element={<SystemOps />} />
              <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
              <Route path="/admin/users" element={adminPage(<UserManagement />)} />
              <Route path="/admin/devices" element={adminPage(<DeviceManagement />)} />
              <Route path="/admin/records" element={adminPage(<RecordManagement />)} />
              <Route path="*" element={<Result status="404" title="未找到页面" extra={<Button onClick={() => goView('scene')}>工作空间</Button>} />} />
            </Routes>}
          </Suspense>
        </PageBoundary>
      </main>
      <PicoDock />
    </div>
  )
}
export default function App() {
  const [uiTheme, setUiTheme] = useState<UiTheme>(readTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = uiTheme
    try {
      localStorage.setItem('ui:theme', uiTheme)
    } catch {
      /* 隐私模式下忽略存储失败 */
    }
  }, [uiTheme])
  const toggleTheme = () =>
    setUiTheme((value) => (value === 'dark' ? 'light' : 'dark'))
  return (
    <ConfigProvider
      theme={{
        ...(uiTheme === 'dark' ? darkThemeOverrides : productTheme),
        algorithm:
          uiTheme === 'dark'
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
      }}
    >
      <Suspense fallback={<Skeleton active />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="*"
            element={
              <RequireAuth>
                <MainLayout
                  uiTheme={uiTheme}
                  onToggleTheme={toggleTheme}
                />
              </RequireAuth>
            }
          />
        </Routes>
      </Suspense>
    </ConfigProvider>
  )
}

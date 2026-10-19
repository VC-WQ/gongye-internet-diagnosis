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
  Space,
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
import { deviceLink } from './hooks/usePageQuery'
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

const PRIMARY = [
  { key: '/dashboard', label: '工厂总览' },
  { key: '/devices', label: '设备监测' },
  { key: '/diagnose', label: '智能诊断' },
  { key: '/events', label: '事件处置' },
  { key: '/reports', label: '报告与档案' },
]
const SECONDARY = [
  { key: '/lab', label: '算法实验室' },
  { key: '/ops', label: '系统运维' },
]
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
function LegacyDiagnosis() {
  const location = useLocation()
  const query = new URLSearchParams(location.search)
  const tab = query.get('tab')
  if (tab === 'timeline' || tab === 'trajectory' || tab === 'report') {
    query.delete('tab')
    return (
      <Navigate
        replace
        to={`${tab === 'report' ? '/reports' : '/events'}?${query}`}
      />
    )
  }
  return <DiagnoseWorkbench />
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
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/'
  const dashboard = normalizedPath === '/dashboard'
  const [seenDashboard, setSeenDashboard] = useState(dashboard)
  const maxIndex = useRef(
    Number(
      window.history.state?.workspaceMax ?? window.history.state?.idx ?? 0,
    ),
  )
  const scroll = useRef<Record<string, number>>({})
  const idx = Number(window.history.state?.idx ?? 0)
  const current = normalizedPath.startsWith('/device/')
    ? '/devices'
    : normalizedPath
  const title =
    [...PRIMARY, ...SECONDARY, ...ADMIN].find((i) => i.key === current)
      ?.label ?? '页面未找到'
  const navRef = useRef<HTMLElement | null>(null)
  const [indicator, setIndicator] = useState({
    left: 0,
    width: 0,
    visible: false,
  })
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const update = () => {
      const active = nav.querySelector<HTMLElement>('button.active')
      if (!active) {
        setIndicator((value) => ({ ...value, visible: false }))
        return
      }
      const navRect = nav.getBoundingClientRect()
      const rect = active.getBoundingClientRect()
      setIndicator({
        left: rect.left - navRect.left,
        width: rect.width,
        visible: true,
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(nav)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [current, uiTheme])
  const params = new URLSearchParams(location.search)
  const workspace = useWorkspace()
  const device = workspace.selectedDeviceId
  const parent = location.pathname.startsWith('/device/')
    ? (() => {
        const saved = sessionStorage.getItem('workspace:path:/devices')
        const query = new URLSearchParams(saved?.split('?')[1])
        if (device) query.set('device', device)
        return `/devices?${query}`
      })()
    : params.has('event')
      ? deviceLink(current, device)
      : '/dashboard'
  useEffect(() => {
    if (dashboard) setSeenDashboard(true)
  }, [dashboard])
  useEffect(() => {
    if (navigationType === 'PUSH') maxIndex.current = idx
    else maxIndex.current = Math.max(maxIndex.current, idx)
    window.history.replaceState(
      { ...window.history.state, workspaceMax: maxIndex.current },
      '',
    )
    if (device) sessionStorage.setItem('workspace:device', device)
    else sessionStorage.removeItem('workspace:device')
    sessionStorage.setItem(
      `workspace:path:${location.pathname}`,
      location.pathname + location.search,
    )
    document.title = `${title} · 工业设备智能诊断平台`
  }, [location, navigationType, idx, device, title])
  useLayoutEffect(() => {
    const key = location.key
    const storageKey = `workspace:scroll:${location.pathname}${location.search}`
    const target =
      scroll.current[key] ?? (Number(sessionStorage.getItem(storageKey)) || 0)
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
      if (
        document.documentElement.scrollHeight - window.innerHeight >=
        target
      ) {
        window.scrollTo(0, target)
        stopRestoring()
      }
    }
    observer = new ResizeObserver(restore)
    const content = document.getElementById('main-content')
    if (content && restoring) observer.observe(content)
    if (restoring) {
      // 内容高度迟迟达不到目标时解锁，避免滚动保存被永久锁住
      unlock = setTimeout(() => {
        restoring = false
        observer?.disconnect()
        window.scrollTo(
          0,
          Math.min(target, document.documentElement.scrollHeight),
        )
      }, 1500)
    }
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
    const interrupt = () => stopRestoring()
    window.addEventListener('scroll', save, { passive: true })
    window.addEventListener('wheel', interrupt, { passive: true })
    window.addEventListener('touchstart', interrupt, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      if (unlock) clearTimeout(unlock)
      window.removeEventListener('scroll', save)
      window.removeEventListener('wheel', interrupt)
      window.removeEventListener('touchstart', interrupt)
    }
  }, [location.key])
  const go = (path: string) => {
    const stored = sessionStorage.getItem(`workspace:path:${path}`)
    const chosen =
      device ?? sessionStorage.getItem('workspace:device') ?? undefined
    const query = new URLSearchParams(stored?.split('?')[1])
    if (chosen && query.get('device') !== chosen) {
      query.set('device', chosen)
      query.delete('event')
    }
    navigate(`${path}${query.size ? `?${query}` : ''}`, {
      state: { returnTo: location.pathname + location.search },
    })
  }
  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith('workspace:') || k.startsWith('factory:'))
      .forEach((k) => sessionStorage.removeItem(k))
    navigate('/login', { replace: true })
  }
  const adminPage = (node: ReactNode) =>
    user.role === 'admin' ? node : <Result status="403" title="没有管理权限" />
  return (
    <div className={`workspace ${dashboard ? 'workspace-overview' : ''}`}>
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>
      <header className="workspace-header">
        <button
          className="brand"
          onClick={() => go('/dashboard')}
          aria-label="工业设备智能诊断平台，工厂总览"
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            工业设备<span className="brand-sub">智能诊断平台</span>
          </span>
        </button>
        <nav className="primary-nav" aria-label="主导航" ref={navRef}>
          {PRIMARY.map((item) => (
            <button
              key={item.key}
              aria-current={current === item.key ? 'page' : undefined}
              className={current === item.key ? 'active' : ''}
              onClick={() => go(item.key)}
            >
              {item.label}
            </button>
          ))}
          <span
            className="nav-indicator"
            aria-hidden
            style={{
              transform: `translateX(${indicator.left}px)`,
              width: indicator.width,
              opacity: indicator.visible ? 1 : 0,
            }}
          />
        </nav>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              ...SECONDARY,
              ...(user.role === 'admin'
                ? [{ type: 'divider' as const }, ...ADMIN]
                : []),
            ],
            onClick: ({ key }) => go(key),
          }}
        >
          <Button type="text" className="more-button">
            更多 <span aria-hidden>⌄</span>
          </Button>
        </Dropdown>
        <div className="account">
          <span className="account-avatar">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <span>{user.username}</span>
          <Button type="text" onClick={onToggleTheme} aria-label="切换深浅主题">
            {uiTheme === 'dark' ? '浅色' : '深色'}
          </Button>
          <Button type="text" onClick={logout}>
            退出
          </Button>
        </div>
      </header>
      <div className="workspace-toolbar">
        <div className="history-actions">
          <Button
            aria-label="后退"
            title="后退"
            disabled={idx === 0}
            onClick={() => navigate(-1)}
          >
            ‹
          </Button>
          <Button
            aria-label="前进"
            title="前进"
            disabled={idx >= maxIndex.current}
            onClick={() => navigate(1)}
          >
            ›
          </Button>
        </div>
        <span className="toolbar-divider" />
        <span className="breadcrumb">
          工作空间 <span>/</span> {title}
          {location.pathname.startsWith('/device/') && (
            <>
              <span>/</span> 设备详情
            </>
          )}
        </span>
        {(location.pathname.startsWith('/device/') || params.has('event')) && (
          <Button
            type="text"
            className="parent-button"
            onClick={() => navigate(parent)}
          >
            上一级
          </Button>
        )}
        <span className="toolbar-end">
          {dashboard ? '运行监控' : '设备运维工作台'}
        </span>
      </div>
      <main
        id="main-content"
        className={dashboard ? 'overview-content' : 'business-content'}
        tabIndex={-1}
      >
        <PageBoundary>
          <Suspense
            fallback={
              <div className="loading-state">
                <Skeleton active paragraph={{ rows: 5 }} />
              </div>
            }
          >
            {(seenDashboard || dashboard) && (
              <div hidden={!dashboard} aria-hidden={!dashboard}>
                <Dashboard active={dashboard} />
              </div>
            )}
            {!dashboard && (
              <PageBoundary key={location.pathname}>
                <Routes>
                  <Route
                    path="/"
                    element={<Navigate to="/dashboard" replace />}
                  />
                  <Route path="/diagnose" element={<LegacyDiagnosis />} />
                  <Route path="/devices" element={<DeviceCenter />} />
                  <Route path="/device/:deviceId" element={<DeviceDetail />} />
                  <Route path="/events" element={<EventCenter />} />
                  <Route path="/reports" element={<ReportCenter />} />
                  <Route path="/lab" element={<ModelLab />} />
                  <Route path="/ops" element={<SystemOps />} />
                  <Route
                    path="/admin"
                    element={<Navigate to="/admin/users" replace />}
                  />
                  <Route
                    path="/admin/users"
                    element={adminPage(<UserManagement />)}
                  />
                  <Route
                    path="/admin/devices"
                    element={adminPage(<DeviceManagement />)}
                  />
                  <Route
                    path="/admin/records"
                    element={adminPage(<RecordManagement />)}
                  />
                  <Route
                    path="*"
                    element={
                      <Result
                        status="404"
                        title="未找到页面"
                        extra={
                          <Button onClick={() => go('/dashboard')}>
                            工厂总览
                          </Button>
                        }
                      />
                    }
                  />
                </Routes>
              </PageBoundary>
            )}
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

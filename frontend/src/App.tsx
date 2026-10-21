import { useSpatialNavigate } from './hooks/useSpatialNavigate'
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Button,
  ConfigProvider,
  Result,
  Skeleton,
  theme as antdTheme,
} from 'antd'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  useParams,
} from 'react-router-dom'
import { RealtimeProvider } from './services/realtime'
import { WorkspaceProvider, useWorkspace } from './services/workspace'
import { PicoProvider } from './features/pico/core/PicoProvider'
import PicoDock from './features/pico/ui/PicoDock'
import { cancelAuthenticatedRequests, getMe, type AuthUser } from './services/api'
import { useResource } from './hooks/useResource'
import {
  areaFromPath,
  legacyRedirect,
  navigationContextPath,
  normalizeTool,
  PANEL_LABELS,
  TOOL_LABELS,
  upperLevelPath,
  type Area,
} from './services/workspaceMode'
import { useDeviceCatalog } from './services/realtime'
import { LoadState } from './components/BusinessUI'
import PrimaryNav from './components/PrimaryNav'
import {
  UiPreferencesProvider,
  useUiPreferences,
} from './services/uiPrefs'
import { LoginTransitionProvider, useLoginTransition } from './motion/LoginTransition'
import RouteReady from './motion/RouteReady'

const FactoryWorkspace = lazy(() => import('./features/factory/FactoryWorkspace'))
const ToolsHome = lazy(() => import('./features/tools/ToolsHome'))
const ToolPage = lazy(() => import('./features/tools/ToolPage'))
const AboutPage = lazy(() => import('./features/about/AboutPage'))
const AdminShell = lazy(() => import('./features/admin/AdminShell'))
const Login = lazy(() => import('./pages/Login'))
const UserManagement = lazy(() => import('./pages/UserManagement'))
const DeviceManagement = lazy(() => import('./pages/DeviceManagement'))
const RecordManagement = lazy(() => import('./pages/RecordManagement'))
const SharedDeviceDetail = lazy(() => import('./features/management/SharedDeviceDetail'))
const SharedRecords = lazy(() => import('./features/management/SharedRecords'))
const SharedRecordDetail = lazy(() => import('./features/management/SharedRecordDetail'))

export const productTheme = {
  token: {
    colorPrimary: '#c13d46',
    colorInfo: '#406783',
    colorSuccess: '#327a60',
    colorWarning: '#946519',
    colorError: '#c13d46',
    colorBgLayout: '#f6f5f2',
    colorBgContainer: '#ffffff',
    colorText: '#272521',
    colorTextSecondary: '#6b6861',
    colorBorder: '#e4e1da',
    colorBorderSecondary: '#eeece6',
    borderRadius: 0,
    borderRadiusLG: 0,
    borderRadiusSM: 0,
    borderRadiusXS: 0,
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
    Table: { headerBg: '#f6f5f2', cellPaddingBlock: 15 },
    Card: { headerFontSize: 15 },
    Tabs: { horizontalItemGutter: 28 },
  },
}

/** 深色主题只覆盖语义 token，品牌主色与按钮直角规则保持不变。 */
const darkThemeOverrides = {
  ...productTheme,
  token: {
    ...productTheme.token,
    colorPrimary: '#df6c73',
    colorSuccess: '#83c4a4',
    colorWarning: '#d6b369',
    colorError: '#ee8b91',
    colorInfo: '#91b5be',
    colorBgLayout: '#191918',
    colorBgContainer: '#232321',
    colorBgElevated: '#2d2c29',
    colorText: '#f2eee5',
    colorTextSecondary: '#b4aea2',
    colorBorder: '#3d3b35',
    colorBorderSecondary: '#33322d',
  },
  components: {
    ...productTheme.components,
    Table: { headerBg: '#2b2a27', cellPaddingBlock: 15 },
  },
}

class PageBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
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

function loading() {
  return (
    <div className="loading-state">
      <Skeleton active paragraph={{ rows: 5 }} />
    </div>
  )
}

const ADMIN_PAGES = [
  { key: 'users', label: '用户', path: '/admin/users' },
  { key: 'devices', label: '设备', path: '/admin/devices' },
  { key: 'records', label: '诊断记录', path: '/admin/records' },
] as const

function routeTitle(pathname: string, panel: string, area: Area): string {
  if (area === 'tools') {
    const parts = pathname.split('/').filter(Boolean)
    const tool = normalizeTool(parts[1])
    return tool ? TOOL_LABELS[tool] : '工具'
  }
  if (area === 'research') return '研究'
  if (area === 'admin') {
    if (pathname.startsWith('/manage/devices')) return '设备详情'
    if (pathname.startsWith('/manage/records')) return '诊断记录'
    const page = pathname.split('/')[2]
    return ADMIN_PAGES.find((item) => item.key === page)?.label ?? '管理'
  }
  return panel === 'none' ? '工厂' : PANEL_LABELS[panel as keyof typeof PANEL_LABELS] ?? '工厂'
}

function AdminPage({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <AdminShell title={title}>
      {children}
    </AdminShell>
  )
}

function LegacyOrNotFound() {
  const location = useLocation()
  const navigate = useSpatialNavigate()
  const target = legacyRedirect(location.pathname, location.search)
  if (target)
    return <Navigate to={target} replace state={location.state} />
  return (
    <Result
      status="404"
      title="未找到页面"
      extra={
        <Button onClick={() => navigate('/dashboard')}>返回工厂</Button>
      }
    />
  )
}

function FactoryRoute() {
  const location = useLocation()
  const target = legacyRedirect('/dashboard', location.search)
  if (target) return <Navigate to={target} replace state={location.state} />
  return <FactoryWorkspace />
}

function ToolRoute({ user }: { user: AuthUser }) {
  const params = useParams()
  const tool = normalizeTool(params.tool)
  if (!tool) return <Navigate to="/tools" replace />
  if (tool === 'simulation' && user.role !== 'admin')
    return <Result status="403" title="没有管理权限" />
  return <ToolPage tool={tool} />
}

function LoginRoute() {
  return <Login />
}

/** Research APIs are already public; operational data and writes remain protected. */
function PublicResearchLayout() {
  const location = useLocation()
  const navigate = useSpatialNavigate()
  const { theme, toggleTheme } = useUiPreferences()
  useEffect(() => { document.title = '研究中心 · 工业设备智能诊断平台' }, [])
  return <div className="workspace workspace-area-research" data-area="research">
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <header className="workspace-header">
      <button className="brand" onClick={() => navigate('/login')} aria-label="工业设备智能诊断平台，登录">
        <span className="brand-mark" aria-hidden><i /><i /><i /></span><span>工业设备<span className="brand-sub">智能诊断平台</span></span>
      </button>
      <PrimaryNav items={[{ key: 'research', label: '研究', path: '/research' }]} active="research" onNavigate={item => navigate(item.path)} />
      <div className="account"><Button type="text" aria-label="切换深浅主题" onClick={toggleTheme}>{theme === 'dark' ? '浅色' : '深色'}</Button><Button type="text" onClick={() => navigate('/login')}>登录工作空间</Button></div>
    </header>
    <main id="main-content" className="workspace-route-content business-content" tabIndex={-1}>
      <PageBoundary resetKey={location.pathname}><Suspense fallback={loading()}><Routes>
        <Route path="/research/:topicId?/:pointId?" element={<AboutPage />} />
        <Route path="*" element={<LegacyOrNotFound />} />
      </Routes></Suspense></PageBoundary>
    </main>
  </div>
}

function AppEntry() {
  const location = useLocation()
  if (!localStorage.getItem('token') && /^\/(research|about)(\/|$)/.test(location.pathname)) return <PublicResearchLayout />
  return <RequireAuth><MainLayout /></RequireAuth>
}

function MainLayout() {
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
          <Workspace user={account.data} />
        </PicoProvider>
      </WorkspaceProvider>
    </RealtimeProvider>
  )
}

function Workspace({ user }: { user: AuthUser }) {
  const navigate = useSpatialNavigate()
  const { beginLogout } = useLoginTransition()
  const location = useLocation()
  const navigationType = useNavigationType()
  const workspace = useWorkspace()
  const catalog = useDeviceCatalog()
  const area = areaFromPath(location.pathname)
  const title = routeTitle(location.pathname, workspace.panel, area)
  const selected = catalog.data?.find((item) => item.id === workspace.selectedDeviceId)
  const upper = upperLevelPath(location.pathname, location.search)
  const maxIndex = useRef(
    Number(window.history.state?.workspaceMax ?? window.history.state?.idx ?? 0),
  )
  const scroll = useRef<Record<string, number>>({})
  const idx = Number(window.history.state?.idx ?? 0)

  useEffect(() => {
    if (navigationType === 'PUSH') maxIndex.current = idx
    else maxIndex.current = Math.max(maxIndex.current, idx)
    window.history.replaceState(
      { ...window.history.state, workspaceMax: maxIndex.current },
      '',
    )
    if (workspace.selectedDeviceId)
      sessionStorage.setItem('workspace:device', workspace.selectedDeviceId)
    else sessionStorage.removeItem('workspace:device')
    sessionStorage.setItem(
      `workspace:path:${area}`,
      location.pathname + location.search,
    )
    document.title = `${title} · 工业设备智能诊断平台`
  }, [
    location,
    navigationType,
    idx,
    workspace.selectedDeviceId,
    title,
    area,
  ])

  useLayoutEffect(() => {
    // The research shell owns article scroll; keep the tree and its position stable.
    if (area === 'research') return
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
      if (document.documentElement.scrollHeight - window.innerHeight >= target) {
        window.scrollTo(0, target)
        stopRestoring()
      }
    }
    observer = new ResizeObserver(restore)
    const content = document.getElementById('main-content')
    if (content && restoring) observer.observe(content)
    if (restoring)
      unlock = setTimeout(() => {
        restoring = false
        observer?.disconnect()
        window.scrollTo(
          0,
          Math.min(target, document.documentElement.scrollHeight),
        )
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

  const withContext = (path: string) => navigationContextPath(path, workspace.selectedDeviceId, workspace.selectedEventId)

  const logout = () => {
    beginLogout(() => {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      cancelAuthenticatedRequests()
      Object.keys(sessionStorage)
        .filter(
          (key) => key.startsWith('workspace:') || key.startsWith('factory:'),
        )
        .forEach((key) => sessionStorage.removeItem(key))
    })
  }

  const navItems = [
    { key: 'factory', label: '工厂', path: '/dashboard' },
    { key: 'tools', label: '工具', path: '/tools' },
    { key: 'admin', label: '管理', path: user.role === 'admin' ? '/admin/devices' : '/manage/records' },
    { key: 'research', label: '研究', path: '/research' },
  ]

  return (
    <div className={`workspace workspace-area-${area}`} data-area={area}>
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>
      <header className="workspace-header">
        <button
          className="brand"
          onClick={() => navigate(withContext('/dashboard'))}
          aria-label="工业设备智能诊断平台，工厂"
        >
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>
            工业设备<span className="brand-sub">智能诊断平台</span>
          </span>
        </button>
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
            disabled={navigationType === 'PUSH' || idx >= maxIndex.current}
            onClick={() => navigate(1)}
          >
            ›
          </Button>
          <Button
            aria-label="上一级"
            title="上一级"
            disabled={!upper}
            onClick={() => upper && navigate(withContext(upper))}
          >
            ↑
          </Button>
        </div>
        <PrimaryNav
          items={navItems}
          active={area}
          onNavigate={(item) => navigate(withContext(item.path))}
        />
        {selected && area === 'factory' && (
          <span className="workspace-device-context" title={selected.name}>
            {selected.name}
          </span>
        )}
        <div className="account">
          <span className="account-avatar" title={user.username}>
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <Button type="text" className="account-name" aria-label={`账户 ${user.username}`}>
            {user.username}
          </Button>
          <Button type="text" onClick={logout} aria-label="退出登录">
            退出
          </Button>
        </div>
      </header>
      <main
        id="main-content"
        className={`workspace-route-content ${
          area === 'factory' ? 'factory-content' : 'business-content'
        }`}
        tabIndex={-1}
      >
        <PageBoundary resetKey={location.pathname}>
          <Suspense fallback={loading()}>
            <Routes>
              <Route path="/dashboard" element={<FactoryRoute />} />
              <Route path="/tools" element={<ToolsHome />} />
              <Route
                path="/tools/:tool"
                element={<ToolRoute user={user} />}
              />
              <Route path="/research/:topicId?/:pointId?" element={<AboutPage />} />
              <Route path="/manage/devices/:deviceId?" element={<SharedDeviceDetail />} />
              <Route path="/manage/records" element={<SharedRecords />} />
              <Route path="/manage/records/:eventId" element={<SharedRecordDetail />} />
              <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
              <Route
                path="/admin/users"
                element={
                  user.role === 'admin' ? (
                    <AdminPage title="用户管理">
                      <UserManagement />
                    </AdminPage>
                  ) : (
                    <Result status="403" title="没有管理权限" />
                  )
                }
              />
              <Route
                path="/admin/devices"
                element={
                  user.role === 'admin' ? (
                    <AdminPage title="设备管理">
                      <DeviceManagement />
                    </AdminPage>
                  ) : (
                    <Result status="403" title="没有管理权限" />
                  )
                }
              />
              <Route
                path="/admin/records"
                element={
                  user.role === 'admin' ? (
                    <AdminPage title="诊断记录管理">
                      <RecordManagement />
                    </AdminPage>
                  ) : (
                    <Result status="403" title="没有管理权限" />
                  )
                }
              />
              <Route path="*" element={<LegacyOrNotFound />} />
            </Routes>
            <RouteReady />
          </Suspense>
        </PageBoundary>
      </main>
      <PicoDock />
    </div>
  )
}

function ThemedApp() {
  const location = useLocation()
  const { theme, reducedMotion } = useUiPreferences()
  const selectedTheme = useMemo(
    () => ({
      ...(theme === 'dark' ? darkThemeOverrides : productTheme),
      token: {
        ...(theme === 'dark' ? darkThemeOverrides : productTheme).token,
        motion: !reducedMotion,
      },
      algorithm:
        theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    }),
    [theme, reducedMotion],
  )
  useEffect(() => {
    ConfigProvider.config({
      holderRender: (children) => (
        <ConfigProvider theme={selectedTheme}>{children}</ConfigProvider>
      ),
    })
    return () => ConfigProvider.config({ holderRender: undefined })
  }, [selectedTheme])
  return (
    <ConfigProvider theme={selectedTheme}>
      <LoginTransitionProvider>
        <Suspense key={location.pathname === '/login' ? 'login' : 'workspace'} fallback={<Skeleton active />}>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route
              path="*"
              element={<AppEntry />}
            />
          </Routes>
        </Suspense>
      </LoginTransitionProvider>
    </ConfigProvider>
  )
}

export default function App() {
  return (
    <UiPreferencesProvider>
      <ThemedApp />
    </UiPreferencesProvider>
  )
}

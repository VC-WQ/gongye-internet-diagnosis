import { type ReactNode } from 'react'
import { Button, Layout, Menu, Space } from 'antd'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import DeviceDetail from './pages/DeviceDetail'
import DiagnoseWorkbench from './pages/DiagnoseWorkbench'
import DeviceCenter from './pages/DeviceCenter'
import ModelLab from './pages/ModelLab'
import SystemOps from './pages/SystemOps'
import Login from './pages/Login'
import UserManagement from './pages/UserManagement'
import DeviceManagement from './pages/DeviceManagement'
import RecordManagement from './pages/RecordManagement'

const { Header, Content } = Layout

// 普通用户可见菜单（5 个业务页，智能会诊为首个业务入口）
const BASE_MENU = [
  { key: '/diagnose', label: '智能会诊' },
  { key: '/dashboard', label: '设备大屏' },
  { key: '/devices', label: '设备中心' },
  { key: '/lab', label: '算法实验室' },
  { key: '/ops', label: '系统运维' },
]

// 管理员子菜单（挂在「系统管理」父菜单下）
const ADMIN_MENU = [
  { key: '/admin/users', label: '用户管理' },
  { key: '/admin/devices', label: '设备管理' },
  { key: '/admin/records', label: '诊断记录' },
]

interface AuthUser {
  username: string
  role: string
}

function getAuthUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem('user') ?? 'null')
  } catch {
    return null
  }
}

function RequireAuth({ children }: { children: ReactNode }) {
  if (!localStorage.getItem('token')) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = getAuthUser()
  const isAdmin = user?.role === 'admin'
  const menuItems = isAdmin
    ? [...BASE_MENU, { key: '/admin', label: '系统管理', children: ADMIN_MENU }]
    : BASE_MENU

  // 扁平化所有叶子 key，用于菜单高亮定位
  const leafKeys = isAdmin
    ? [...BASE_MENU.map((m) => m.key), ...ADMIN_MENU.map((m) => m.key)]
    : BASE_MENU.map((m) => m.key)

  const selectedKey = (() => {
    // 设备详情页归属「设备中心」高亮
    if (location.pathname.startsWith('/device/')) return '/devices'
    return leafKeys.find((k) => location.pathname.startsWith(k)) ?? '/diagnose'
  })()

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <div className="app-title">
          <span className="logo-dot" />
          工业设备智能诊断系统
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={(e) => navigate(e.key)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Space>
          <span style={{ color: '#fff' }}>
            {user?.username ?? ''}
            {isAdmin ? '（管理员）' : ''}
          </span>
          <Button size="small" onClick={logout}>
            退出登录
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/diagnose" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/diagnose" element={<DiagnoseWorkbench />} />
          <Route path="/devices" element={<DeviceCenter />} />
          <Route path="/device/:deviceId" element={<DeviceDetail />} />
          <Route path="/lab" element={<ModelLab />} />
          <Route path="/ops" element={<SystemOps />} />
          <Route path="/admin/users" element={<UserManagement />} />
          <Route path="/admin/devices" element={<DeviceManagement />} />
          <Route path="/admin/records" element={<RecordManagement />} />
          <Route path="*" element={<Navigate to="/diagnose" replace />} />
        </Routes>
      </Content>
    </Layout>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="*"
        element={
          <RequireAuth>
            <MainLayout />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

export default App
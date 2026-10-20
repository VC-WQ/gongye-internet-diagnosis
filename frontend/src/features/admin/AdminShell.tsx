import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { PageHeading } from '../../components/BusinessUI'
import './admin.css'
import '../management/management.css'

const PAGES = [
  { key: 'users', label: '用户', path: '/admin/users' },
  { key: 'devices', label: '设备', path: '/admin/devices' },
  { key: 'records', label: '诊断记录', path: '/admin/records' },
]

export default function AdminShell({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const location = useLocation()
  const navigate = useSpatialNavigate()
  const active = location.pathname.split('/')[2] ?? 'users'
  return (
    <div className="admin-shell">
      <PageHeading title={title} meta={<span>后台管理</span>} />
      <nav className="admin-nav" aria-label="管理页面">
        {PAGES.map((page) => (
          <button
            key={page.key}
            type="button"
            className={active === page.key ? 'is-active' : ''}
            aria-current={active === page.key ? 'page' : undefined}
            onClick={() => navigate(page.path)}
          >
            {page.label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  )
}

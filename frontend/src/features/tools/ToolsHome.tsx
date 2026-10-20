import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { PageHeading } from '../../components/BusinessUI'
import { useWorkspace } from '../../services/workspace'
import './tools.css'

interface ToolCard {
  key: string
  title: string
  description: string
  path: string
  adminOnly?: boolean
}

const TOOL_CARDS: ToolCard[] = [
  { key: 'diagnosis', title: '智能诊断', description: '选择设备与有效采样，发起诊断并查看证据。沿用真实诊断流程和未闭环事件保护。', path: '/tools/diagnosis' },
  { key: 'events', title: '事件与报告', description: '在同一任务中选择事件、查看证据、完成处置，并生成与复制报告。', path: '/tools/events' },
  {
    key: 'simulation',
    title: '仿真测试',
    description: '在隔离的仿真目录中切换设备状态，用于验证状态筛选、场景与诊断链路；不代表现场设备。',
    path: '/tools/simulation',
    adminOnly: true,
  },
  {
    key: 'vision',
    title: '缺陷检测',
    description: '上传部件图像，调用后端视觉检测服务返回缺陷位置、类别与置信度。',
    path: '/tools/vision',
  },
  {
    key: 'pico',
    title: '数字伴侣',
    description: '与右下角 Pico 共用同一个会话：查询当前设备、事件与报告，只读、不执行写操作。',
    path: '/tools/pico',
  },
  {
    key: 'evaluation',
    title: '系统自评',
    description: '读取真实诊断记录计算准确率、误报率、漏报率与阈值调整效果。',
    path: '/tools/evaluation',
  },
  {
    key: 'settings',
    title: '系统设置',
    description: '界面偏好与主题，刷新后保持。设备级阈值建议在设备分析中处理。',
    path: '/tools/settings',
  },
]

function currentRole(): string {
  try {
    return JSON.parse(localStorage.getItem('user') ?? '{}').role ?? 'reader'
  } catch {
    return 'reader'
  }
}

export default function ToolsHome() {
  const navigate = useSpatialNavigate()
  const workspace = useWorkspace()
  const role = currentRole()
  const tools = TOOL_CARDS.filter((tool) => !tool.adminOnly || role === 'admin')
  const link = (path: string) => {
    const query = new URLSearchParams()
    if (workspace.selectedDeviceId) query.set('device', workspace.selectedDeviceId)
    if (workspace.selectedEventId)
      query.set('event', String(workspace.selectedEventId))
    return `${path}${query.size ? `?${query}` : ''}`
  }
  return (
    <>
      <PageHeading title="工具" />
      <div className="tool-grid">
        {tools.map((tool) => (
          <button type="button" className="tool-card" key={tool.key} onClick={() => navigate(link(tool.path))}>
            <div className="tool-card__body">
              <h2>{tool.title}</h2>
              <p>{tool.description}</p>
            </div>
            <span className="tool-card__direction" aria-hidden>↗</span>
          </button>
        ))}
      </div>
    </>
  )
}

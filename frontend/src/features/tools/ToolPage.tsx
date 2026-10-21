import { PageHeading } from '../../components/BusinessUI'
import { TOOL_LABELS, type ToolKey } from '../../services/workspaceMode'
import FaultInjection from '../../pages/FaultInjection'
import VisionDetect from '../../components/VisionDetect'
import SystemEval from '../../pages/SystemEval'
import PicoWorkbench from '../pico/ui/PicoWorkbench'
import SettingsTool from './SettingsTool'
import DiagnosisTool from './DiagnosisTool'
import EventsTool from './EventsTool'
import './tools.css'

const META: Partial<Record<ToolKey, string>> = {
  simulation: '仅管理员可执行 · 只修改仿真目录状态',
  pico: '与全局 Pico 助手共用同一会话，查询业务与研究资料，打开页面、切换主题或预填设备表单',
}

export default function ToolPage({ tool }: { tool: ToolKey }) {
  const content =
    tool === 'diagnosis' ? <DiagnosisTool /> : tool === 'events' ? <EventsTool /> : tool === 'simulation' ? (
      <FaultInjection />
    ) : tool === 'vision' ? (
      <VisionDetect />
    ) : tool === 'pico' ? (
      <PicoWorkbench />
    ) : tool === 'evaluation' ? (
      <SystemEval />
    ) : (
      <SettingsTool />
    )
  return (
    <>
      <div data-route-module="tool-heading"><PageHeading title={TOOL_LABELS[tool]} meta={META[tool]} /></div>
      <div data-route-module-scope={`tool-${tool}`}>{content}</div>
    </>
  )
}

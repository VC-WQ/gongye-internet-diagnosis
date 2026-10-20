import { PageHeading } from '../../components/BusinessUI'
import { TOOL_LABELS, type ToolKey } from '../../services/workspaceMode'
import FaultInjection from '../../pages/FaultInjection'
import VisionDetect from '../../components/VisionDetect'
import SystemEval from '../../pages/SystemEval'
import PicoWorkbench from '../pico/ui/PicoWorkbench'
import SettingsTool from './SettingsTool'
import './tools.css'

const META: Partial<Record<ToolKey, string>> = {
  simulation: '仅管理员可执行 · 只修改仿真目录状态',
  pico: '与全局 Pico 助手共用同一会话与只读工具',
}

export default function ToolPage({ tool }: { tool: ToolKey }) {
  const content =
    tool === 'simulation' ? (
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
      <PageHeading title={TOOL_LABELS[tool]} meta={META[tool]} />
      {content}
    </>
  )
}

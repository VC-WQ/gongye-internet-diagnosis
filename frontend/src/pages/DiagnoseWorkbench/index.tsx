import { useState } from 'react'
import { Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import ChatWindow from '../ChatWindow'
import Timeline from '../Timeline'
import ReportCenter from '../ReportCenter'

/**
 * AI 诊断工作台：把「会诊 → 时间线 → 报告」三个环节收敛为一个诊断闭环。
 *   - AI 会诊：多智能体协同诊断，产出诊断报告与建议
 *   - 事件时间线：诊断事件的传感器曲线 / 隐状态 / 处置标注
 *   - 诊断报告：快报与事件报告的 Markdown 汇总
 * 支持 ?tab=trajectory 通过 URL 定位到指定环节（如从设备详情跳转）。
 */
export default function DiagnoseWorkbench() {
  const [searchParams] = useSearchParams()
  const [active, setActive] = useState(searchParams.get('tab') ?? 'chat')

  return (
    <Tabs
      activeKey={active}
      onChange={setActive}
      items={[
        { key: 'chat', label: '智能会诊', children: <ChatWindow /> },
        { key: 'timeline', label: '事件时间线', children: <Timeline /> },
        { key: 'report', label: '诊断报告', children: <ReportCenter /> },
      ]}
    />
  )
}
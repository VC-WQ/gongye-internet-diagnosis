import { Tabs } from 'antd'
import SystemEval from '../SystemEval'
import ThresholdSuggestions from '../ThresholdSuggestions'
import SelfEvolutionLoop from '../../components/SelfEvolutionLoop'

/**
 * 系统运维：三个运维视角。
 *   - 双闭环自进化：内闭环（事件级自动再诊断）× 外闭环（阈值建议人工采纳）
 *   - 系统自评    ：诊断准确率 / 误报率 / 漏报率 / 平均延迟 + 阈值效果跟踪
 *   - 动态阈值建议：阈值建议的采纳/拒绝人工闭环
 */
export default function SystemOps() {
  return (
    <Tabs
      defaultActiveKey="evolution"
      items={[
        { key: 'evolution', label: '双闭环自进化', children: <SelfEvolutionLoop /> },
        { key: 'eval', label: '系统自评', children: <SystemEval /> },
        { key: 'threshold', label: '动态阈值建议', children: <ThresholdSuggestions /> },
      ]}
    />
  )
}

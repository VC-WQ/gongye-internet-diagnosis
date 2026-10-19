import { Tabs } from 'antd'
import SystemEval from '../SystemEval'
import ThresholdSuggestions from '../ThresholdSuggestions'
import SelfEvolutionLoop from '../../components/SelfEvolutionLoop'
import { usePageQuery } from '../../hooks/usePageQuery'
import { PageHeading, SourceTag } from '../../components/BusinessUI'
export default function SystemOps() {
  const { params, update } = usePageQuery()
  const active = ['evolution', 'eval', 'threshold'].includes(
    params.get('tab') ?? '',
  )
    ? params.get('tab')!
    : 'evolution'
  return (
    <>
      <PageHeading title="系统运维" meta={<SourceTag source="history" />} />
      <Tabs
        activeKey={active}
        onChange={(tab) => update({ tab })}
        items={[
          {
            key: 'evolution',
            label: '运行闭环',
            children: <SelfEvolutionLoop />,
          },
          { key: 'eval', label: '系统自评', children: <SystemEval /> },
          {
            key: 'threshold',
            label: '阈值管理',
            children: <ThresholdSuggestions />,
          },
        ]}
      />
    </>
  )
}

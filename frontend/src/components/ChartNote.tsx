import type { CSSProperties, ReactNode } from 'react'
import { Popover } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'

export interface ChartNoteProps {
  /** 图表说明：这张图展示了什么、怎么画出来的 */
  desc: string
  /** 数据来源：这张图用了哪份数据（数据集名称 + 规模 + 来源），用于区分仿真数据与真实公开数据集 */
  dataSource: string
  /** 如何解读：结论落点 / 怎么看懂（可选） */
  insight?: string
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#22d3ee',
  marginTop: 4,
}

const textStyle: CSSProperties = {
  fontSize: 12,
  color: '#cbd5e1',
  lineHeight: 1.7,
  margin: 0,
}

/**
 * 图表说明 (ChartNote)：
 *   - 悬浮时图标高亮为品牌青，点击弹出结构化说明浮层；
 *   - 统一回答三个问题：图表说明 / 数据来源 / 如何解读；
 *   - 通过「数据来源」字段明确标出每张图用的是哪份数据，
 *     从而区隔「设备大屏的仿真数据 + 钢铁表面痕迹」与「算法实验室的真实公开数据集」两类主题。
 */
export default function ChartNote({ desc, dataSource, insight }: ChartNoteProps) {
  const content: ReactNode = (
    <div style={{ width: 300, maxWidth: '78vw' }}>
      <div style={labelStyle}>图表说明</div>
      <p style={textStyle}>{desc}</p>
      <div style={labelStyle}>数据来源</div>
      <p style={textStyle}>{dataSource}</p>
      {insight ? (
        <>
          <div style={labelStyle}>如何解读</div>
          <p style={textStyle}>{insight}</p>
        </>
      ) : null}
    </div>
  )

  return (
    <Popover
      placement="bottomRight"
      trigger="click"
      content={content}
      title={<span style={{ fontSize: 13 }}>图表说明</span>}
    >
      <span
        style={{
          cursor: 'pointer',
          fontSize: 12,
          color: '#64748b',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          userSelect: 'none',
          transition: 'color .2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#22d3ee'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#64748b'
        }}
      >
        <InfoCircleOutlined /> 说明
      </span>
    </Popover>
  )
}
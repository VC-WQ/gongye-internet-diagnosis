import { Popover } from 'antd'
export interface ChartNoteProps {
  desc: string
  dataSource: string
  insight?: string
}
export default function ChartNote({
  desc,
  dataSource,
  insight,
}: ChartNoteProps) {
  return (
    <Popover
      placement="bottomRight"
      trigger="click"
      title="图表与来源"
      content={
        <div className="chart-note-content">
          <h4>数据来源</h4>
          <p>{dataSource}</p>
          <h4>指标含义</h4>
          <p>{desc}</p>
          {insight && (
            <>
              <h4>解读</h4>
              <p>{insight}</p>
            </>
          )}
        </div>
      }
    >
      <button
        type="button"
        className="chart-note-button"
        aria-label="查看图表说明与数据来源"
      >
        <span aria-hidden>ⓘ</span> 来源
      </button>
    </Popover>
  )
}

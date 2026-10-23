import {
  STATUS_FILTERS,
  STATUS_LABELS,
  type StatusFilter,
} from '../../services/workspaceMode'
import { STATUS_META } from '../../components/BusinessUI'
import FlipValue from '../../motion/FlipValue'
import FlipText from '../../motion/FlipText'

export default function StatusOverview({
  counts,
  filter,
  onFilter,
  connection,
}: {
  counts: Record<StatusFilter, number>
  filter: StatusFilter
  onFilter: (status: StatusFilter) => void
  connection: 'connecting' | 'connected' | 'disconnected'
}) {
  return (
    <div className="factory-statusbar">
      <div
        className="factory-statusbar__filters"
        role="group"
        aria-label="设备状态筛选"
      >
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            className={`status-filter ${filter === status ? 'is-active' : ''}`}
            aria-pressed={filter === status}
            onClick={() => onFilter(status)}
          >
            <i
              style={{
                background:
                  status === 'all' ? 'var(--text)' : STATUS_META[status]?.hex,
              }}
              aria-hidden
            />
            <span>{STATUS_LABELS[status]}</span>
            <strong>
              <FlipValue
                value={counts[status].toString().padStart(2, '0')}
                label={`${STATUS_LABELS[status]} ${counts[status]} 台`}
              />
            </strong>
          </button>
        ))}
      </div>
      <div className="factory-statusbar__tools">
        <span
          className={`connection ${connection === 'connected' ? 'connected' : ''}`}
          title="实时采样推送状态"
        >
          <i aria-hidden />
          <FlipText value={connection === 'connected'
            ? '推送已连接'
            : connection === 'connecting'
              ? '正在连接'
              : '推送中断 · 定时刷新'} />
        </span>

      </div>
    </div>
  )
}

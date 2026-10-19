import { Alert, Button, Empty, Skeleton, Tag, Tooltip } from 'antd'
import type { ReactNode } from 'react'

export const TYPE_LABEL: Record<string, string> = {
  pump: '离心泵',
  motor: '驱动电机',
  compressor: '空压机',
}
export const STATUS_META: Record<
  string,
  { label: string; color: string; hex: string }
> = {
  healthy: { label: '正常', color: 'success', hex: '#51b89b' },
  degraded: { label: '退化', color: 'warning', hex: '#dba55a' },
  fault: { label: '告警', color: 'error', hex: '#df6e73' },
  offline: { label: '离线', color: 'default', hex: '#7d8997' },
}
export const EVENT_META: Record<string, { label: string; color: string }> = {
  normal: { label: '正常', color: 'success' },
  warning: { label: '预警', color: 'warning' },
  alarm: { label: '告警', color: 'error' },
  consulting: { label: '诊断中', color: 'processing' },
  pending: { label: '待确认', color: 'warning' },
  handling: { label: '处置中', color: 'processing' },
  observing: { label: '观察期', color: 'cyan' },
  recovered: { label: '已恢复', color: 'success' },
  relapsed: { label: '复发', color: 'error' },
}
export function StatusTag({
  status,
  event = false,
}: {
  status?: string | null
  event?: boolean
}) {
  const meta = (event ? EVENT_META : STATUS_META)[status ?? '']
  return <Tag color={meta?.color}>{meta?.label ?? status ?? '状态未知'}</Tag>
}
export function PageHeading({
  title,
  meta,
  actions,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  )
}
export function LoadState({
  loading,
  error,
  empty,
  onRetry,
  children,
  emptyText = '暂无数据',
}: {
  loading?: boolean
  error?: string
  empty?: boolean
  onRetry?: () => void
  children?: ReactNode
  emptyText?: string
}) {
  if (loading)
    return (
      <div className="loading-state">
        <Skeleton active paragraph={{ rows: 3 }} />
      </div>
    )
  if (error)
    return (
      <Alert
        type="error"
        showIcon
        message={error}
        action={
          onRetry && (
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          )
        }
      />
    )
  if (empty)
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    )
  return <>{children}</>
}
export function SourceTag({ source = 'unknown' }: { source?: string }) {
  const names: Record<string, string> = {
    realtime: '实时采集',
    simulator: '设备仿真',
    simulation: '设备仿真',
    device_simulation: '设备仿真',
    offline_experiment: '离线实验',
    history: '历史记录',
    unknown: '来源未确认',
  }
  return (
    <Tooltip
      title={source === 'unknown' ? '接口未提供可确认的数据来源' : undefined}
    >
      <span className="source-tag">{names[source] ?? '来源未确认'}</span>
    </Tooltip>
  )
}
export function formatTime(value?: string | number | null) {
  if (value == null) return '—'
  const date = new Date(
    typeof value === 'number' && value < 1e12 ? value * 1000 : value,
  )
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { hour12: false })
    : '—'
}
export function numberText(value: unknown, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : '—'
}

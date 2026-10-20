import { useEffect, useRef, useState } from 'react'
import { Button, Empty, Select, Space, message } from 'antd'
import ReactMarkdown from 'react-markdown'
import DiagnosisSummary from '../../../components/DiagnosisSummary'
import { LoadState } from '../../../components/BusinessUI'
import {
  getEventReport,
  getFlashReport,
  type Device,
  type EventSummary,
} from '../../../services/api'
import { errorText } from '../../../hooks/useResource'

export default function ReportDocumentPanel({
  device,
  event,
  eventId,
  events,
  loading: eventLoading,
  error: eventError,
  onSelect,
  onRefreshEvent,
  onOpenEvent,
}: {
  device?: Device
  event?: EventSummary
  eventId?: number
  events: EventSummary[]
  loading: boolean
  error?: string
  onSelect: (id: number) => void
  onRefreshEvent: () => void
  onOpenEvent: () => void
}) {
  const [document, setDocument] = useState<{ key: string; text: string }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const key = `${device?.id ?? 'all'}:${eventId ?? 'flash'}`
  useEffect(() => {
    sequence.current += 1
    setLoading(false)
    setError('')
    return () => {
      sequence.current += 1
    }
  }, [key])

  const generate = async (flash: boolean) => {
    if (!flash && !eventId) return
    const request = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const response = flash
        ? await getFlashReport(device ? { device_id: device.id } : {})
        : await getEventReport(eventId!)
      if (request === sequence.current) {
        if (typeof response.report !== 'string')
          throw new Error('报告内容不可用')
        setDocument({ key, text: response.report })
      }
    } catch (caught) {
      if (request === sequence.current) setError(errorText(caught))
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }

  const text = document?.key === key ? document.text : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制报告')
    } catch {
      message.error('复制失败，请检查浏览器权限')
    }
  }

  return (
    <article className="report-panel">
      <div className="report-panel__bar">
        <Select
          aria-label="报告事件"
          allowClear
          placeholder="设备快报"
          value={eventId}
          onChange={(value) => onSelect(Number(value))}
          options={events.map((item) => ({
            value: item.id,
            label: `#${item.id} · ${item.agent_diagnosis?.fault_label ?? item.fault_type ?? '诊断事件'}`,
          }))}
        />
        <Space wrap>
          {eventId && (
            <Button
              size="small"
              loading={loading}
              onClick={() => generate(false)}
            >
              生成事件报告
            </Button>
          )}
          <Button
            size="small"
            loading={loading && !eventId}
            onClick={() => generate(true)}
          >
            生成设备快报
          </Button>
          <Button size="small" disabled={!text} onClick={copy}>
            复制
          </Button>
          <Button
            size="small"
            disabled={!text && !event}
            onClick={() => window.print()}
          >
            打印
          </Button>
        </Space>
      </div>
      <LoadState
        loading={loading || (Boolean(eventId) && eventLoading)}
        error={error || (eventId ? eventError : undefined)}
        onRetry={error ? () => generate(!eventId) : onRefreshEvent}
      >
        {text ? (
          <div className="report-content">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : eventId && event ? (
          <DiagnosisSummary event={event} />
        ) : eventId ? (
          <Empty description="未找到事件" />
        ) : (
          <div className="chart-empty report-panel__empty">
            <Button loading={loading} onClick={() => generate(true)}>
              生成设备快报
            </Button>
          </div>
        )}
      </LoadState>
      {eventId && (
        <div className="actions-row">
          <Button onClick={onOpenEvent}>查看事件与证据</Button>
        </div>
      )}
    </article>
  )
}

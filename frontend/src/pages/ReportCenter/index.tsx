import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { useEffect, useRef, useState } from 'react'
import { Button, Select, Space, message } from 'antd'
import ReactMarkdown from 'react-markdown'
import {
  getEvent,
  getEventReport,
  getFlashReport,
  listEvents,
} from '../../services/api'
import { useResource, errorText } from '../../hooks/useResource'
import { deviceLink, usePageQuery } from '../../hooks/usePageQuery'
import { useDeviceCatalog } from '../../services/realtime'
import {
  formatTime,
  LoadState,
  PageHeading,
  SourceTag,
  StatusTag,
} from '../../components/BusinessUI'
import DiagnosisSummary from '../../components/DiagnosisSummary'

export default function ReportCenter() {
  const { params, update } = usePageQuery()
  const navigate = useSpatialNavigate()
  const catalog = useDeviceCatalog()
  const device = params.get('device') ?? undefined
  const eventId = Number(params.get('event')) || undefined
  const list = useResource(`reports:${device ?? 'all'}`, () =>
    listEvents({ device_id: device, limit: 50 }),
  )
  const selected = useResource(
    `report-event:${eventId ?? ''}`,
    () => getEvent(eventId!),
    0,
    Boolean(eventId),
  )
  const [document, setDocument] = useState<{ key: string; text: string }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const key = `${device ?? 'all'}:${eventId ?? 'flash'}`
  useEffect(() => {
    sequence.current += 1
    setLoading(false)
    setError('')
    return () => {
      sequence.current += 1
    }
  }, [key])
  useEffect(() => {
    if (selected.data && selected.data.device_id !== device)
      update({ device: selected.data.device_id }, true)
  }, [selected.data?.id, selected.data?.device_id, device])
  const generate = async (flash: boolean) => {
    const request = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const response = flash
        ? await getFlashReport(device ? { device_id: device } : {})
        : await getEventReport(eventId!)
      if (request === sequence.current) {
        if (typeof response.report !== 'string')
          throw new Error('报告内容不可用')
        setDocument({ key, text: response.report })
      }
    } catch (e) {
      if (request === sequence.current) setError(errorText(e))
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
    <>
      <PageHeading
        title="报告与档案"
        meta={<SourceTag source="history" />}
        actions={
          <Button
            loading={loading}
            onClick={() => {
              update({ event: undefined })
              if (!eventId) void generate(true)
            }}
          >
            设备快报
          </Button>
        }
      />
      <div className="filter-bar">
        <Select
          aria-label="报告设备筛选"
          allowClear
          placeholder="全部设备"
          value={device}
          onChange={(value) => update({ device: value, event: undefined })}
          options={catalog.data?.map((d) => ({ value: d.id, label: d.name }))}
        />
        <span className="filter-end">
          最近 {list.data?.length ?? '—'} 份诊断记录
        </span>
      </div>
      <div className="business-split">
        <section className="surface">
          <div className="section-header">
            <h2>诊断档案</h2>
          </div>
          <LoadState
            loading={list.loading}
            error={list.error}
            onRetry={list.refresh}
            empty={!list.data?.length}
            emptyText="暂无诊断档案"
          >
            <div className="record-list">
              {list.data?.map((event) => (
                <button
                  key={event.id}
                  className={`record-item ${eventId === event.id ? 'selected' : ''}`}
                  onClick={() =>
                    update({ event: String(event.id), device: event.device_id })
                  }
                >
                  <span>
                    <strong>
                      #{event.id} ·{' '}
                      {event.agent_diagnosis?.fault_label ??
                        event.fault_type ??
                        '诊断报告'}
                    </strong>
                    <small>{event.device_id}</small>
                    <small>{formatTime(event.timestamp)}</small>
                  </span>
                  <StatusTag status={event.status_state} event />
                </button>
              ))}
            </div>
          </LoadState>
        </section>
        <article className="surface">
          <div className="section-header">
            <h2>{eventId ? `诊断报告 #${eventId}` : '设备快报'}</h2>
            <Space wrap>
              {eventId && (
                <Button
                  size="small"
                  loading={loading}
                  onClick={() => generate(false)}
                >
                  生成文档
                </Button>
              )}
              <Button size="small" disabled={!text} onClick={copy}>
                复制
              </Button>
              <Button
                size="small"
                disabled={!text && !selected.data}
                onClick={() => window.print()}
              >
                打印
              </Button>
            </Space>
          </div>
          <LoadState
            loading={loading || (Boolean(eventId) && selected.loading)}
            error={error || (eventId ? selected.error : undefined)}
            onRetry={error ? () => generate(!eventId) : selected.refresh}
          >
            {text ? (
              <div className="report-content">
                <ReactMarkdown>{text}</ReactMarkdown>
              </div>
            ) : eventId && selected.data ? (
              <DiagnosisSummary event={selected.data} />
            ) : (
              <div className="chart-empty" style={{ minHeight: 260 }}>
                <Button loading={loading} onClick={() => generate(true)}>
                  生成设备快报
                </Button>
              </div>
            )}
          </LoadState>
          {selected.data && eventId && (
            <div className="actions-row">
              <Button
                onClick={() =>
                  navigate(
                    deviceLink('/events', selected.data!.device_id, eventId),
                  )
                }
              >
                查看事件与证据
              </Button>
            </div>
          )}
        </article>
      </div>
    </>
  )
}

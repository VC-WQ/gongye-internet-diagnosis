import { useEffect } from 'react'
import { Button, Select, Space, Tabs } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { getEvent, listEvents } from '../../services/api'
import { useResource } from '../../hooks/useResource'
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
import EventActions from '../../components/EventActions'
import Timeline from '../Timeline'

export default function EventCenter() {
  const { params, update } = usePageQuery()
  const navigate = useNavigate()
  const location = useLocation()
  const catalog = useDeviceCatalog()
  const device = params.get('device') ?? undefined
  const eventId = Number(params.get('event')) || undefined
  const page = Math.max(1, Number(params.get('page')) || 1)
  const list = useResource(
    `events:${device ?? 'all'}:${page}`,
    () => listEvents({ device_id: device, limit: 20, offset: (page - 1) * 20 }),
    10000,
  )
  const selected = useResource(
    `event:${eventId ?? ''}`,
    () => getEvent(eventId!),
    5000,
    Boolean(eventId),
  )
  useEffect(() => {
    if (selected.data && selected.data.device_id !== device)
      update({ device: selected.data.device_id, page: undefined }, true)
  }, [selected.data?.id, selected.data?.device_id, device])
  const event = selected.data
  return (
    <>
      <PageHeading
        title="事件处置"
        meta={
          <>
            <SourceTag source="history" />
            <span>诊断、确认与处置记录</span>
          </>
        }
        actions={
          <Button
            onClick={() => {
              list.refresh()
              selected.refresh()
            }}
          >
            刷新
          </Button>
        }
      />
      <div className="filter-bar">
        <Select
          aria-label="事件设备筛选"
          allowClear
          placeholder="全部设备"
          value={device}
          onChange={(value) =>
            update({ device: value, event: undefined, page: undefined })
          }
          options={catalog.data?.map((d) => ({ value: d.id, label: d.name }))}
        />
        <span className="filter-end">
          第 {page} 页 · {list.data?.length ?? '—'} 条
        </span>
      </div>
      <div className="business-split">
        <section className="surface">
          <div className="section-header">
            <h2>事件列表</h2>
          </div>
          <LoadState
            loading={list.loading && !list.data}
            error={list.error}
            onRetry={list.refresh}
            empty={!list.data?.length}
            emptyText="暂无诊断事件"
          >
            <div className="record-list">
              {list.data?.map((item) => (
                <button
                  key={item.id}
                  className={`record-item ${eventId === item.id ? 'selected' : ''}`}
                  onClick={() =>
                    update({
                      event: String(item.id),
                      page: undefined,
                      device: item.device_id,
                      tab: undefined,
                    })
                  }
                >
                  <span>
                    <strong>
                      #{item.id} ·{' '}
                      {item.agent_diagnosis?.fault_label ??
                        item.fault_type ??
                        '诊断事件'}
                    </strong>
                    <small>{item.device_id}</small>
                    <small>{formatTime(item.timestamp)}</small>
                  </span>
                  <StatusTag status={item.status_state} event />
                </button>
              ))}
            </div>
          </LoadState>
          <div className="actions-row">
            <Button
              size="small"
              disabled={page === 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              上一页
            </Button>
            <Button
              size="small"
              disabled={!list.data || list.data.length < 20}
              onClick={() => update({ page: String(page + 1) })}
            >
              下一页
            </Button>
          </div>
        </section>
        <section className="surface">
          <LoadState
            loading={Boolean(eventId) && selected.loading && !event}
            error={selected.error}
            onRetry={selected.refresh}
            empty={!event}
            emptyText="选择一条事件查看详情"
          >
            {event && (
              <>
                <div className="section-header">
                  <h2>事件 #{event.id}</h2>
                  <Button
                    size="small"
                    onClick={() =>
                      navigate(
                        deviceLink('/reports', event.device_id, event.id),
                        {
                          state: {
                            returnTo: location.pathname + location.search,
                          },
                        },
                      )
                    }
                  >
                    诊断报告 ›
                  </Button>
                </div>
                <Tabs
                  activeKey={
                    params.get('tab') === 'timeline' ? 'timeline' : 'summary'
                  }
                  onChange={(tab) => update({ tab })}
                  items={[
                    {
                      key: 'summary',
                      label: '诊断与处置',
                      children: (
                        <>
                          <DiagnosisSummary event={event} />
                          <EventActions
                            key={event.id}
                            event={event}
                            onChanged={() => {
                              selected.refresh()
                              list.refresh()
                            }}
                          />
                        </>
                      ),
                    },
                    {
                      key: 'timeline',
                      label: '证据与时间线',
                      children: <Timeline eventId={event.id} />,
                    },
                  ]}
                />
              </>
            )}
          </LoadState>
        </section>
      </div>
    </>
  )
}

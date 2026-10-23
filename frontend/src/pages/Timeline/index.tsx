import { Select, Tabs, Timeline as AntTimeline } from 'antd'
import ThemedChart from '../../components/ThemedChart'
import { getTimelineEvent } from '../../services/api'
import { useResource } from '../../hooks/useResource'
import { usePageQuery } from '../../hooks/usePageQuery'
import { CHANNELS } from '../../services/realtime'
import { formatTime, LoadState, SourceTag } from '../../components/BusinessUI'

interface TimelineData {
  sensor?: { points?: number; series?: Record<string, Array<number | null>> }
  latent?: {
    available?: boolean
    simulated?: boolean
    series?: Record<string, Array<number | null>>
  }
  annotations?: Array<{
    type: string
    label: string
    time?: string
    from?: string
    to?: string
    operator?: string
    reason?: string
  }>
}
export default function Timeline({ eventId }: { eventId?: number }) {
  const { params, update } = usePageQuery()
  const data = useResource<TimelineData>(
    `timeline:${eventId}`,
    () => getTimelineEvent(eventId!),
    5000,
    Boolean(eventId),
  )
  const valid = Object.entries(CHANNELS).filter(([key]) =>
    data.data?.sensor?.series?.[key]?.some(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ),
  )
  const channel = valid.some(([key]) => key === params.get('channel'))
    ? params.get('channel')!
    : valid[0]?.[0]
  const meta = CHANNELS[channel]
  const plot = (
    series: Array<{ name: string; values: Array<number | null> }>,
    name: string,
  ) => ({
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: series.length > 1 ? { top: 0 } : undefined,
    grid: { top: 42, left: 52, right: 20, bottom: 42 },
    xAxis: { type: 'value', name: '采样点', minInterval: 1 },
    yAxis: { type: 'value', name, scale: true },
    series: series.map((s) => ({
      type: 'line',
      name: s.name,
      showSymbol: false,
      connectNulls: false,
      data: s.values.map((v, i) => [
        i,
        typeof v === 'number' && Number.isFinite(v) ? v : null,
      ]),
    })),
  })
  const latent =
    data.data?.latent?.available && !data.data.latent.simulated
      ? Object.entries(data.data.latent.series ?? {}).filter(
          ([, values]) => values.length,
        )
      : []
  return (
    <LoadState
      loading={data.loading}
      error={data.error}
      onRetry={data.refresh}
      empty={!data.data}
      emptyText="暂无事件证据"
    >
      <div className="chart-source">
        <SourceTag source="history" />
        <span>事件采样快照 · {data.data?.sensor?.points ?? 0} 点</span>
      </div>
      <Tabs
        activeKey={params.get('evidence') === 'latent' ? 'latent' : 'sensor'}
        onChange={(evidence) => update({ evidence })}
        items={[
          {
            key: 'sensor',
            label: '传感器',
            children: (
              <>
                <div className="filter-bar">
                  <Select
                    aria-label="事件传感器通道"
                    value={channel}
                    onChange={(value) => update({ channel: value }, true)}
                    options={valid.map(([value, m]) => ({
                      value,
                      label: `${m.name} · ${m.unit}`,
                    }))}
                  />
                </div>
                <LoadState empty={!channel} emptyText="暂无传感器证据">
                  <ThemedChart

                    style={{ height: 260 }}
                    option={plot(
                      [
                        {
                          name: meta?.name ?? '',
                          values: data.data?.sensor?.series?.[channel] ?? [],
                        },
                      ],
                      meta?.unit ?? '',
                    )}
                  />
                </LoadState>
              </>
            ),
          },
          {
            key: 'latent',
            label: '孪生隐状态',
            children: (
              <LoadState
                empty={!latent.length}
                emptyText="暂无已记录的孪生隐状态"
              >
                <ThemedChart

                  style={{ height: 260 }}
                  option={plot(
                    latent.map(([key, values]) => ({
                      name:
                        (
                          {
                            latent_wear: '磨损',
                            latent_heat: '热积累',
                            latent_efficiency: '效率',
                          } as Record<string, string>
                        )[key] ?? key,
                      values,
                    })),
                    '归一化值',
                  )}
                />
              </LoadState>
            ),
          },
        ]}
      />
      <div className="section-header" style={{ marginTop: 26 }}>
        <h2>处置时间线</h2>
      </div>
      <LoadState
        empty={!data.data?.annotations?.length}
        emptyText="暂无时间线记录"
      >
        <AntTimeline
          items={data.data?.annotations?.map((item) => ({
            color:
              item.type === 'recovery'
                ? 'green'
                : item.type === 'trigger'
                  ? 'red'
                  : 'gray',
            children: (
              <>
                <strong style={{ fontSize: 13 }}>{item.label}</strong>
                <div className="page-meta">
                  {formatTime(item.time)}
                  {item.operator ? ` · ${item.operator}` : ''}
                </div>
                {item.reason && (
                  <p
                    style={{
                      fontSize: 12,
                      lineHeight: 1.8,
                      color: "var(--muted)",
                      marginTop: 6,
                    }}
                  >
                    {item.reason}
                  </p>
                )}
              </>
            ),
          }))}
        />
      </LoadState>
    </LoadState>
  )
}

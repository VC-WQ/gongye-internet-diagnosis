import '../../theme/echarts'
import { Button, Card, Empty, Select, Space, Tabs } from 'antd'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import {
  getAcousticFusion,
  getAcousticSpectrum,
  getDevice,
  getHealthHistory,
  getTimelineDevice,
  getTimelineEvent,
  listEvents,
} from '../../services/api'
import { useResource } from '../../hooks/useResource'
import { deviceLink, usePageQuery } from '../../hooks/usePageQuery'
import { CHANNELS, useDeviceTelemetry } from '../../services/realtime'
import {
  formatTime,
  LoadState,
  numberText,
  PageHeading,
  SourceTag,
  StatusTag,
  TYPE_LABEL,
} from '../../components/BusinessUI'
import SensorChart from '../../components/SensorChart'
import DigitalTwinPhm from '../../components/DigitalTwinPhm'

export default function DeviceDetail() {
  const { deviceId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { params, update } = usePageQuery()
  const tab = params.get('tab') ?? 'realtime'
  const channel =
    params.get('channel') && CHANNELS[params.get('channel')!]
      ? params.get('channel')!
      : 'vibration'
  const device = useResource(
    `device:${deviceId}`,
    () => getDevice(deviceId),
    10000,
  )
  const telemetry = useDeviceTelemetry(deviceId)
  const history = useResource(
    `health:${deviceId}`,
    () => getHealthHistory(deviceId),
    0,
    tab === 'history',
  )
  const latent = useResource(
    `latent:${deviceId}`,
    async () => {
      const d = await getTimelineDevice(deviceId)
      const first = d.events?.[0]
      return first ? getTimelineEvent(first.event_id) : undefined
    },
    0,
    tab === 'latent',
  )
  const acoustic = useResource(
    `acoustic:${deviceId}`,
    async () => {
      const [spectrum, fusion] = await Promise.all([
        getAcousticSpectrum(deviceId),
        getAcousticFusion(deviceId),
      ])
      return { spectrum, fusion }
    },
    0,
    tab === 'acoustic',
  )
  const events = useResource(
    `device-events:${deviceId}`,
    () => listEvents({ device_id: deviceId, limit: 20 }),
    0,
    tab === 'events',
  )
  const go = (path: string) =>
    navigate(path, { state: { returnTo: location.pathname + location.search } })
  const latentSeries = latent.data?.latent?.series ?? {}
  const acousticData = acoustic.data?.spectrum
  const chartBase = {
    animation: false,
    tooltip: { trigger: 'axis' },
    grid: { left: 55, right: 28, top: 42, bottom: 42 },
  }
  return (
    <>
      <PageHeading
        title={device.data?.name ?? '设备详情'}
        meta={
          <>
            <span>{deviceId}</span>
            <span>
              {device.data
                ? (TYPE_LABEL[device.data.device_type] ??
                  device.data.device_type)
                : ''}
            </span>
            <StatusTag status={device.data?.status} />
            <SourceTag source={telemetry.source} />
          </>
        }
        actions={
          <>
            <Button onClick={() => go(deviceLink('/events', deviceId))}>
              相关事件
            </Button>
            <Button
              type="primary"
              onClick={() => go(deviceLink('/diagnose', deviceId))}
            >
              智能诊断
            </Button>
          </>
        }
      />
      <LoadState
        loading={device.loading && !device.data}
        error={device.error}
        onRetry={device.refresh}
      >
        {device.data && (
          <div className="metric-strip">
            <div>
              <span>目录健康评分</span>
              <strong>{numberText(device.data.health_score, 0)}</strong>
              <small>/ 100</small>
            </div>
            <div>
              <span>边缘异常分数</span>
              <strong>
                {numberText(
                  typeof device.data.edge_anomaly_score === 'number'
                    ? device.data.edge_anomaly_score * 100
                    : undefined,
                )}
              </strong>
              <small>%</small>
            </div>
            <div>
              <span>振动阈值</span>
              <strong>{numberText(device.data.threshold_vibration)}</strong>
              <small>g</small>
            </div>
            <div>
              <span>最近有效采样</span>
              <strong style={{ fontSize: 14 }}>
                {telemetry.last
                  ? formatTime(telemetry.last.timestamp)
                  : '暂无采样'}
              </strong>
              {telemetry.stale && <small>已过期</small>}
            </div>
          </div>
        )}
      </LoadState>
      <Card>
        <Tabs
          activeKey={
            [
              'realtime',
              'history',
              'latent',
              'acoustic',
              'phm',
              'events',
            ].includes(tab)
              ? tab
              : 'realtime'
          }
          onChange={(value) => update({ tab: value })}
          items={[
            {
              key: 'realtime',
              label: '实时监测',
              children: (
                <>
                  <div className="section-header">
                    <h2>采样窗口</h2>
                    <Select
                      aria-label="实时传感器通道"
                      value={channel}
                      onChange={(value) => update({ channel: value }, true)}
                      options={Object.entries(CHANNELS).map(
                        ([value, meta]) => ({
                          value,
                          label: `${meta.name} · ${meta.unit}`,
                        }),
                      )}
                    />
                  </div>
                  <LoadState
                    error={telemetry.error}
                    onRetry={telemetry.refresh}
                  >
                    <SensorChart
                      samples={telemetry.samples}
                      channel={channel}
                      height={330}
                    />
                  </LoadState>
                  <div className="chart-source">
                    <SourceTag source={telemetry.source} />
                    <span>
                      {telemetry.stale
                        ? '数据已过期'
                        : telemetry.last
                          ? `采样时间 ${formatTime(telemetry.last.timestamp)}`
                          : '暂无有效采样'}{' '}
                      · {telemetry.samples.length} 点
                    </span>
                  </div>
                </>
              ),
            },
            {
              key: 'history',
              label: '健康历史',
              children: (
                <LoadState
                  loading={history.loading}
                  error={history.error}
                  onRetry={history.refresh}
                  empty={!history.data?.length}
                  emptyText="暂无健康历史"
                >
                  <SourceTag source="history" />
                  <ReactECharts
                    theme="tech-dark"
                    style={{ height: 330 }}
                    option={{
                      ...chartBase,
                      xAxis: {
                        type: 'category',
                        data: history.data?.map((h: { timestamp: string }) =>
                          formatTime(h.timestamp),
                        ),
                      },
                      yAxis: {
                        type: 'value',
                        name: '健康评分',
                        min: 0,
                        max: 100,
                      },
                      series: [
                        {
                          name: '健康评分',
                          type: 'line',
                          showSymbol: false,
                          data: history.data?.map(
                            (h: { health_score: number }) => h.health_score,
                          ),
                          connectNulls: false,
                        },
                      ],
                    }}
                  />
                </LoadState>
              ),
            },
            {
              key: 'latent',
              label: '孪生隐状态',
              children: (
                <LoadState
                  loading={latent.loading}
                  error={latent.error}
                  onRetry={latent.refresh}
                  empty={
                    !Object.values(latentSeries).some(
                      (s) => Array.isArray(s) && s.length,
                    )
                  }
                  emptyText="暂无孪生隐状态"
                >
                  <SourceTag source="history" />
                  <ReactECharts
                    theme="tech-dark"
                    style={{ height: 330 }}
                    option={{
                      ...chartBase,
                      legend: { top: 0 },
                      xAxis: { type: 'value', name: '采样点' },
                      yAxis: {
                        type: 'value',
                        name: '归一化值',
                        min: 0,
                        max: 1,
                      },
                      series: Object.entries(latentSeries)
                        .filter(([, s]) => Array.isArray(s))
                        .map(([key, values]) => ({
                          name:
                            (
                              {
                                latent_wear: '磨损',
                                latent_heat: '热积累',
                                latent_efficiency: '效率',
                              } as Record<string, string>
                            )[key] ?? key,
                          type: 'line',
                          showSymbol: false,
                          data: (values as number[]).map((v, i) => [i, v]),
                        })),
                    }}
                  />
                </LoadState>
              ),
            },
            {
              key: 'acoustic',
              label: '声学频谱',
              children: (
                <LoadState
                  loading={acoustic.loading}
                  error={acoustic.error}
                  onRetry={acoustic.refresh}
                  empty={!acousticData?.spectrum?.length}
                  emptyText="暂无声学频谱"
                >
                  <div className="chart-source">
                    <SourceTag
                      source={acousticData?._meta?.source ?? 'unknown'}
                    />
                    <span>
                      跨模态一致性{' '}
                      {numberText(
                        typeof acoustic.data?.fusion?.cross_modal_agreement ===
                          'number'
                          ? acoustic.data.fusion.cross_modal_agreement * 100
                          : undefined,
                      )}
                      %
                    </span>
                  </div>
                  <ReactECharts
                    theme="tech-dark"
                    style={{ height: 330 }}
                    option={{
                      tooltip: { position: 'top' },
                      grid: { left: 65, right: 20, top: 30, bottom: 70 },
                      xAxis: {
                        type: 'category',
                        data: acousticData?.time,
                        name: '时间帧',
                      },
                      yAxis: {
                        type: 'category',
                        data: acousticData?.freq,
                        name: 'Hz',
                      },
                      visualMap: {
                        min: 0,
                        max: 1,
                        orient: 'horizontal',
                        left: 'center',
                        bottom: 0,
                      },
                      series: [
                        {
                          type: 'heatmap',
                          data: acousticData?.spectrum?.flatMap(
                            (row: number[], t: number) =>
                              row.map((v, f) => [t, f, v]),
                          ),
                        },
                      ],
                    }}
                  />
                </LoadState>
              ),
            },
            {
              key: 'phm',
              label: '孪生研究',
              children: (
                <>
                  <div className="chart-source">
                    <SourceTag source="offline_experiment" />
                    <span>离线预测性维护研究</span>
                  </div>
                  <DigitalTwinPhm />
                </>
              ),
            },
            {
              key: 'events',
              label: '历史事件',
              children: (
                <LoadState
                  loading={events.loading}
                  error={events.error}
                  onRetry={events.refresh}
                  empty={!events.data?.length}
                  emptyText="暂无设备事件"
                >
                  <div className="record-list">
                    {events.data?.map((event) => (
                      <button
                        className="record-item"
                        key={event.id}
                        onClick={() =>
                          go(deviceLink('/events', deviceId, event.id))
                        }
                      >
                        <span>
                          <strong>
                            #{event.id} ·{' '}
                            {event.agent_diagnosis?.fault_label ??
                              event.fault_type ??
                              '诊断事件'}
                          </strong>
                          <small>{formatTime(event.timestamp)}</small>
                        </span>
                        <StatusTag status={event.status_state} event />
                      </button>
                    ))}
                  </div>
                </LoadState>
              ),
            },
          ]}
        />
      </Card>
    </>
  )
}

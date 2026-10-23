import '../factory.css'
import { Empty, Select, Tag } from 'antd'
import Tabs from '../../../motion/ContentTabs'
import ThemedChart from '../../../components/ThemedChart'
import SensorChart from '../../../components/SensorChart'
import DigitalTwinPhm from '../../../components/DigitalTwinPhm'
import ThresholdSuggestions from '../../../pages/ThresholdSuggestions'
import {
  formatTime,
  LoadState,
  numberText,
  STATUS_META,
  StatusTag,
  TYPE_LABEL,
} from '../../../components/BusinessUI'
import {
  getAcousticFusion,
  getAcousticSpectrum,
  getHealthHistory,
  getTimelineDevice,
  getTimelineEvent,
  type Device,
  type EventSummary,
} from '../../../services/api'
import { useResource } from '../../../hooks/useResource'
import { CHANNELS, type useDeviceTelemetry } from '../../../services/realtime'
import FlipValue from '../../../motion/FlipValue'
import FlipText from '../../../motion/FlipText'
import FlipContent from '../../../motion/FlipContent'
import {
  DETAIL_TABS,
  DETAIL_LABELS,
  type DetailTab,
} from '../../../services/workspaceMode'

const SOURCE_LABEL: Record<string, string> = {
  realtime: '实时采集',
  simulator: '设备仿真',
  simulation: '设备仿真',
  device_simulation: '设备仿真',
  offline_experiment: '离线实验',
  history: '历史记录',
}

function sourceText(source?: string) {
  if (!source || source === 'unknown') return ''
  return SOURCE_LABEL[source] ?? ''
}

export default function DeviceAnalysisPanel({
  device,
  telemetry,
  tab,
  onTab,
  channel,
  onChannel,
  events,
  eventsLoading,
  eventsError,
  onRefreshEvents,
  onSelectEvent,
}: {
  device?: Device
  telemetry: ReturnType<typeof useDeviceTelemetry>
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  channel: string
  onChannel: (channel: string) => void
  events: EventSummary[]
  eventsLoading: boolean
  eventsError?: string
  onRefreshEvents: () => void
  onSelectEvent: (id: number) => void
}) {
  const deviceId = device?.id ?? ''
  const activeChannel = CHANNELS[channel] ? channel : 'vibration'
  const history = useResource(
    `health:${deviceId}`,
    () => getHealthHistory(deviceId),
    0,
    Boolean(deviceId) && tab === 'history',
  )
  const latent = useResource(
    `latent:${deviceId}`,
    async () => {
      const data = await getTimelineDevice(deviceId)
      const first = data?.events?.[0]
      return first ? getTimelineEvent(first.event_id) : undefined
    },
    0,
    Boolean(deviceId) && tab === 'latent',
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
    Boolean(deviceId) && tab === 'acoustic',
  )
  const latentSeries = latent.data?.latent?.series ?? {}
  const acousticData = acoustic.data?.spectrum
  const chartBase = {
    animation: false,
    tooltip: { trigger: 'axis' as const },
    grid: { left: 55, right: 28, top: 42, bottom: 42 },
  }
  return (
    <div className="analysis-panel">
      <FlipContent identity={deviceId || 'no-device'}>
      {device && (
        <div className="analysis-summary">
          <div className="analysis-head">
            <div>
              <h3><FlipText value={device.name} /></h3>
              <p>
                {device.id} ·{' '}
                {TYPE_LABEL[device.device_type] ?? device.device_type}{' '}
                <StatusTag animated status={device.status} />
              </p>
            </div>
            <span className="analysis-head__updated">
              目录更新 {formatTime(device.last_updated)}
            </span>
          </div>
          <div className="analysis-metrics">
            <div>
              <span>目录健康评分</span>
              <strong style={{ color: STATUS_META[device.status]?.hex }}>
                <FlipValue
                  value={numberText(device.health_score, 0)}
                  label={`健康评分 ${numberText(device.health_score, 0)} / 100`}
                />
              </strong>
              <small>/ 100</small>
            </div>
            <div>
              <span>边缘异常分数</span>
              <strong>
                <FlipValue
                  value={numberText(
                    typeof device.edge_anomaly_score === 'number'
                      ? device.edge_anomaly_score * 100
                      : undefined,
                  )}
                />
              </strong>
              <small>%</small>
            </div>
            <div>
              <span>振动阈值</span>
              <strong>
                <FlipValue value={numberText(device.threshold_vibration)} />
              </strong>
              <small>g</small>
            </div>
            <div>
              <span>最近有效采样</span>
              <strong className="is-time">
                {telemetry.last ? formatTime(telemetry.last.timestamp) : '暂无采样'}
              </strong>
              {telemetry.stale && <small>已过期</small>}
            </div>
          </div>
        </div>
      )}
      </FlipContent>
      {!device ? (
        <Empty description="选择一台设备" />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={(value) => onTab(value as DetailTab)}
          items={DETAIL_TABS.map((key) => {
            if (key === 'realtime')
              return {
                key,
                label: DETAIL_LABELS[key],
                children: (
                  <>
                    <div className="section-header">
                      <h2>采样窗口</h2>
                      <Select
                        aria-label="实时传感器通道"
                        value={activeChannel}
                        onChange={onChannel}
                        options={Object.entries(CHANNELS).map(([value, meta]) => ({
                          value,
                          label: `${meta.name} · ${meta.unit}`,
                        }))}
                      />
                    </div>
                    <LoadState error={telemetry.error} onRetry={telemetry.refresh}>
                      <SensorChart
                        samples={telemetry.samples}
                        channel={activeChannel}
                        height={320}
                      />
                    </LoadState>
                    <div className="chart-source">
                      <span>
                        {sourceText(telemetry.source) || '采样记录'}
                        {telemetry.stale ? ' · 数据已过期' : ''}
                      </span>
                      <span>
                        {telemetry.last
                          ? `采样时间 ${formatTime(telemetry.last.timestamp)}`
                          : '暂无有效采样'}{' '}
                        · {telemetry.samples.length} 点
                      </span>
                    </div>
                  </>
                ),
              }
            if (key === 'history')
              return {
                key,
                label: DETAIL_LABELS[key],
                children: (
                  <LoadState
                    loading={history.loading}
                    error={history.error}
                    onRetry={history.refresh}
                    empty={!history.data?.length}
                    emptyText="暂无健康历史"
                  >
                    <ThemedChart
                      style={{ height: 320 }}
                      option={{
                        ...chartBase,
                        xAxis: {
                          type: 'category',
                          data: (history.data ?? []).map(
                            (item: { timestamp: string }) => formatTime(item.timestamp),
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
                            data: (history.data ?? []).map(
                              (item: { health_score: number }) => item.health_score,
                            ),
                            connectNulls: false,
                          },
                        ],
                      }}
                    />
                  </LoadState>
                ),
              }
            if (key === 'latent')
              return {
                key,
                label: DETAIL_LABELS[key],
                children: (
                  <LoadState
                    loading={latent.loading}
                    error={latent.error}
                    onRetry={latent.refresh}
                    empty={
                      !Object.values(latentSeries).some(
                        (series) => Array.isArray(series) && series.length,
                      )
                    }
                    emptyText="暂无孪生隐状态"
                  >
                    <ThemedChart
                      style={{ height: 320 }}
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
                          .filter(([, values]) => Array.isArray(values))
                          .map(([name, values]) => ({
                            name:
                              (
                                {
                                  latent_wear: '磨损',
                                  latent_heat: '热积累',
                                  latent_efficiency: '效率',
                                } as Record<string, string>
                              )[name] ?? name,
                            type: 'line',
                            showSymbol: false,
                            data: (values as number[]).map((value, index) => [
                              index,
                              value,
                            ]),
                          })),
                      }}
                    />
                  </LoadState>
                ),
              }
            if (key === 'acoustic')
              return {
                key,
                label: DETAIL_LABELS[key],
                children: (
                  <LoadState
                    loading={acoustic.loading}
                    error={acoustic.error}
                    onRetry={acoustic.refresh}
                    empty={!acousticData?.spectrum?.length}
                    emptyText="暂无声学频谱"
                  >
                    <div className="chart-source">
                      <span>
                        {sourceText(acousticData?._meta?.source) || '声学记录'}
                      </span>
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
                    <ThemedChart
                      style={{ height: 320 }}
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
                              (row: number[], time: number) =>
                                row.map((value, freq) => [time, freq, value]),
                            ),
                          },
                        ],
                      }}
                    />
                  </LoadState>
                ),
              }
            if (key === 'threshold')
              return {
                key,
                label: DETAIL_LABELS[key],
                children: (
                  <>
                    <p className="factory-note">
                      阈值建议按设备生成，由管理员审批后写入设备配置；普通账号只读。
                    </p>
                    <ThresholdSuggestions deviceId={device.id} active={tab === 'threshold'} />
                  </>
                ),
              }
            if (key === 'phm')
              return {
                key,
                label: DETAIL_LABELS[key],
                children: (
                  <>
                    <div className="chart-source">
                      <span>离线预测性维护研究</span>
                      <Tag>研究内容</Tag>
                    </div>
                    <DigitalTwinPhm active={tab === 'phm'} />
                  </>
                ),
              }
            return {
              key,
              label: DETAIL_LABELS[key],
              children: (
                <LoadState
                  loading={eventsLoading && !events.length}
                  error={eventsError}
                  onRetry={onRefreshEvents}
                  empty={!eventsLoading && !events.length}
                  emptyText="暂无设备事件"
                >
                  <div className="record-list">
                    {events.map((event) => (
                      <button
                        type="button"
                        className="record-item"
                        key={event.id}
                        onClick={() => onSelectEvent(event.id)}
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
                        <StatusTag animated status={event.status_state} event />
                      </button>
                    ))}
                  </div>
                </LoadState>
              ),
            }
          })}
        />
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  ConfigProvider,
  Empty,
  Select,
  Space,
  theme,
} from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { listEvents } from '../../services/api'
import { useResource } from '../../hooks/useResource'
import { deviceLink, usePageQuery } from '../../hooks/usePageQuery'
import {
  CHANNELS,
  useDeviceCatalog,
  useDeviceTelemetry,
} from '../../services/realtime'
import {
  formatTime,
  LoadState,
  numberText,
  SourceTag,
  STATUS_META,
  StatusTag,
  TYPE_LABEL,
} from '../../components/BusinessUI'
import FactoryScene from '../../components/FactoryScene'
import SensorChart from '../../components/SensorChart'

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#9dc8c1',
    colorInfo: '#9dc8c1',
    colorBgContainer: '#1a2936',
    colorBgElevated: '#233643',
    colorText: '#e1e8ed',
    colorTextSecondary: '#9badba',
    colorBorder: '#3b4e5e',
  },
}
export default function Dashboard({ active = true }: { active?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { params, update } = usePageQuery()
  const catalog = useDeviceCatalog(active)
  const devices = catalog.data ?? []
  const savedId = sessionStorage.getItem('workspace:device')
  const queryId = active ? params.get('device') : savedId
  const selectedId = queryId ?? devices[0]?.id
  const selectedEventId = Number(params.get('event')) || undefined
  const selected = devices.find((d) => d.id === selectedId)
  const telemetry = useDeviceTelemetry(selected?.id, active)
  const events = useResource(
    `overview-events:${selected?.id ?? ''}`,
    () => listEvents({ device_id: selected?.id, limit: 5 }),
    10000,
    active && Boolean(selected),
  )
  const [channel, setChannel] = useState('vibration')
  const [fullscreen, setFullscreen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [fullError, setFullError] = useState('')
  useEffect(() => {
    if (active && !params.has('device') && devices.length)
      update({ device: selectedId }, true)
  }, [active, devices.length, selectedId])
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  const go = (path: string) =>
    navigate(path, { state: { returnTo: location.pathname + location.search } })
  const risk = devices
    .filter((d) => d.status === 'fault' || d.status === 'degraded')
    .sort((a, b) => (a.health_score ?? 100) - (b.health_score ?? 100))
  return (
    <ConfigProvider theme={darkTheme}>
      <div ref={root} className="factory-dashboard">
        <div className="overview-heading">
          <div>
            <span className="eyebrow">运行态势</span>
            <h1>
              工厂总览<span className="heading-slash"> / </span>
              <span className="heading-sub">设备健康监控</span>
            </h1>
          </div>
          <Space>
            <span
              className={`connection ${telemetry.status === 'connected' ? 'connected' : ''}`}
            >
              <i />
              {telemetry.status === 'connected'
                ? '推送已连接'
                : telemetry.status === 'connecting'
                  ? '正在连接'
                  : '推送中断 · 定时刷新'}
            </span>
            <Button
              onClick={async () => {
                try {
                  if (document.fullscreenElement)
                    await document.exitFullscreen()
                  else await root.current?.requestFullscreen()
                } catch {
                  setFullError('浏览器未允许全屏，请使用窗口模式')
                }
              }}
            >
              {fullscreen ? '退出全屏' : '全屏查看'}
            </Button>
          </Space>
        </div>
        {(catalog.error || fullError) && (
          <Alert
            type="warning"
            showIcon
            message={catalog.error ?? fullError}
            action={
              <Button
                onClick={() => {
                  catalog.refresh()
                  setFullError('')
                }}
              >
                重试
              </Button>
            }
          />
        )}
        <div className="overview-metrics">
          <div>
            <span>登记设备</span>
            <strong>
              {catalog.data ? devices.length.toString().padStart(2, '0') : '—'}
            </strong>
            <small>台</small>
          </div>
          {['healthy', 'degraded', 'fault', 'offline'].map((state) => (
            <div key={state}>
              <span>
                <i style={{ background: STATUS_META[state].hex }} />
                {STATUS_META[state].label}
              </span>
              <strong>
                {catalog.data
                  ? devices
                      .filter((d) => d.status === state)
                      .length.toString()
                      .padStart(2, '0')
                  : '—'}
              </strong>
              <small>台</small>
            </div>
          ))}
          <div className="metrics-source">
            <SourceTag source="unknown" />
            <small>设备目录状态</small>
          </div>
        </div>
        <div className="overview-grid">
          <aside className="overview-left">
            <section className="overview-panel">
              <div className="panel-title">
                <h2>关注设备</h2>
                <span>{risk.length}</span>
              </div>
              {!risk.length ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无风险设备"
                />
              ) : (
                risk.map((d) => (
                  <button
                    key={d.id}
                    className={`risk-device ${selectedId === d.id ? 'selected' : ''}`}
                    onClick={() => update({ device: d.id }, true)}
                  >
                    <span>
                      <b>{d.name}</b>
                      <small>{d.id}</small>
                    </span>
                    <span
                      className="risk-score"
                      style={{ color: STATUS_META[d.status]?.hex }}
                    >
                      {numberText(d.health_score, 0)}
                      <small>{STATUS_META[d.status]?.label}</small>
                    </span>
                  </button>
                ))
              )}
            </section>
            <section className="overview-panel">
              <div className="panel-title">
                <h2>设备目录</h2>
                <Button
                  type="text"
                  size="small"
                  onClick={() => go(deviceLink('/devices', selectedId))}
                >
                  全部 ›
                </Button>
              </div>
              <div className="device-type-list">
                {Object.entries(TYPE_LABEL).map(([type, label]) => (
                  <div key={type}>
                    <span>{label}</span>
                    <span>
                      {devices.filter((d) => d.device_type === type).length} 台
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <div className="overview-footnote">
              状态取自设备目录
              <br />
              传感器时效单独判定
            </div>
          </aside>
          <section className="overview-scene-panel" aria-label="中央设备场景">
            <LoadState
              loading={catalog.loading && !catalog.data}
              error={!catalog.data ? catalog.error : undefined}
              onRetry={catalog.refresh}
            >
              <FactoryScene
                devices={devices}
                selected={selectedId}
                onSelect={(id) => update({ device: id }, true)}
              />
            </LoadState>
            <div className="scene-legend">
              {Object.entries(STATUS_META).map(([key, value]) => (
                <span key={key}>
                  <i style={{ background: value.hex }} />
                  {value.label}
                </span>
              ))}
            </div>
          </section>
          <aside className="overview-right">
            <section className="overview-panel selected-panel">
              <div className="panel-title">
                <h2>当前设备</h2>
                <SourceTag source={telemetry.source} />
              </div>
              {!selected ? (
                <Empty
                  description={selectedId ? '设备不存在' : '选择一台设备'}
                />
              ) : (
                <>
                  <div className="selected-device-name">
                    <h3>{selected.name}</h3>
                    <StatusTag status={selected.status} />
                  </div>
                  <div className="selected-device-id">
                    {selected.id} ·{' '}
                    {TYPE_LABEL[selected.device_type] ?? selected.device_type}
                  </div>
                  <div className="selected-health">
                    <strong>{numberText(selected.health_score, 0)}</strong>
                    <div>
                      <span>/ 100</span>
                      <small>目录健康评分</small>
                    </div>
                  </div>
                  <div className="selected-update">
                    目录更新 {formatTime(selected.last_updated)}
                  </div>
                  <div className="selected-actions">
                    <Button
                      onClick={() =>
                        go(deviceLink('/device/' + encodeURIComponent(selected.id), selected.id, selectedEventId))
                      }
                    >
                      设备详情
                    </Button>
                    <Button
                      type="primary"
                      onClick={() => go(deviceLink('/diagnose', selected.id, selectedEventId))}
                    >
                      智能诊断
                    </Button>
                  </div>
                </>
              )}
            </section>
            <section className="overview-panel sensor-panel">
              <div className="panel-title">
                <h2>传感器窗口</h2>
                <Select
                  aria-label="传感器通道"
                  size="small"
                  value={channel}
                  onChange={setChannel}
                  options={Object.entries(CHANNELS).map(([value, meta]) => ({
                    value,
                    label: `${meta.name} · ${meta.unit}`,
                  }))}
                />
              </div>
              {telemetry.error ? (
                <Alert type="warning" message={telemetry.error} />
              ) : (
                <SensorChart
                  samples={telemetry.samples}
                  channel={channel}
                  dark
                  height={165}
                />
              )}
              <div
                className={`telemetry-caption ${telemetry.stale ? 'stale' : ''}`}
              >
                {telemetry.last
                  ? `${telemetry.stale ? '数据已过期' : '采样时间'} · ${formatTime(telemetry.last.timestamp)}`
                  : telemetry.loading
                    ? '正在读取采样窗口'
                    : '暂无有效采样'}
              </div>
            </section>
            <section className="overview-panel">
              <div className="panel-title">
                <h2>最近事件</h2>
                <Button
                  type="text"
                  size="small"
                  onClick={() => go(deviceLink('/events', selectedId, selectedEventId))}
                >
                  查看 ›
                </Button>
              </div>
              <LoadState
                error={events.error}
                empty={!events.loading && !events.data?.length}
                emptyText="暂无诊断事件"
              >
                {events.data?.slice(0, 2).map((event) => (
                  <button
                    key={event.id}
                    className="event-summary"
                    onClick={() =>
                      go(deviceLink('/events', event.device_id, event.id))
                    }
                  >
                    <span>
                      #{event.id} ·{' '}
                      {event.agent_diagnosis?.fault_label ??
                        event.fault_type ??
                        '诊断事件'}
                    </span>
                    <StatusTag status={event.status_state} event />
                  </button>
                ))}
              </LoadState>
            </section>
          </aside>
        </div>
      </div>
    </ConfigProvider>
  )
}

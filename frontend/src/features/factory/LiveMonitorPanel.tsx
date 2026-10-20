import { Empty, Select } from 'antd'
import SensorChart from '../../components/SensorChart'
import { formatTime, SourceTag } from '../../components/BusinessUI'
import { CHANNELS, type useDeviceTelemetry } from '../../services/realtime'
import type { Device } from '../../services/api'

export default function LiveMonitorPanel({
  device,
  telemetry,
  channel,
  onChannel,
}: {
  device?: Device
  telemetry: ReturnType<typeof useDeviceTelemetry>
  channel: string
  onChannel: (channel: string) => void
}) {
  return (
    <section className="factory-panel factory-panel--monitor" aria-label="实时监测">
      <header className="factory-panel__head">
        <h2>实时监测</h2>
        <div className="factory-panel__head-actions">
          <Select
            size="small"
            aria-label="传感器通道"
            value={channel}
            onChange={onChannel}
            popupMatchSelectWidth={false}
            options={Object.entries(CHANNELS).map(([value, meta]) => ({
              value,
              label: meta.name,
            }))}
          />

        </div>
      </header>
      {!device ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="全厂监测：选择设备后显示对应传感器窗口" />
      ) : telemetry.error ? (
        <p className="factory-note factory-note--error">{telemetry.error}</p>
      ) : (
        <>
          <SensorChart
            samples={telemetry.samples}
            channel={channel}
            height={148}
          />
          <div
            className={`factory-caption ${telemetry.stale ? 'is-stale' : ''}`}
          >
            <span>
              {telemetry.last
                ? `${telemetry.stale ? '数据已过期' : '采样时间'} · ${formatTime(telemetry.last.timestamp)}`
                : telemetry.loading
                  ? '正在读取采样窗口'
                  : '暂无有效采样'}
            </span>
            <span><SourceTag source={telemetry.source} /> · {telemetry.samples.length} 点</span>
          </div>
        </>
      )}
    </section>
  )
}

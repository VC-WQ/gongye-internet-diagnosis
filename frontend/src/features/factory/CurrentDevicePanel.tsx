import { useRef } from 'react'
import { Button, Empty } from 'antd'
import {
  formatTime,
  numberText,
  STATUS_META,
  StatusTag,
  TYPE_LABEL,
} from '../../components/BusinessUI'
import type { Device, EventSummary } from '../../services/api'
import FlipValue from '../../motion/FlipValue'
import { useContentTransition } from '../../motion/useContentTransition'

export default function CurrentDevicePanel({
  device,
  outsideFilter,
  activeEvent,
  onAnalyze,
  onDiagnose,
  onOpenEvent,
}: {
  device?: Device
  outsideFilter: boolean
  activeEvent?: EventSummary
  onAnalyze: () => void
  onDiagnose: () => void
  onOpenEvent: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useContentTransition(device?.id, bodyRef)
  return (
    <section className="factory-panel factory-panel--current" aria-label="当前设备">
      <header className="factory-panel__head">
        <h2>当前设备</h2>
        {device && <StatusTag status={device.status} />}
      </header>
      {!device ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一台设备" />
      ) : (
        <div className="current-device__body" ref={bodyRef}>
          <div className="current-device__name">{device.name}</div>
          <div className="current-device__meta">
            {device.id} · {TYPE_LABEL[device.device_type] ?? device.device_type}
          </div>
          <div className="current-device__health">
            <strong style={{ color: STATUS_META[device.status]?.hex }}>
              <FlipValue
                value={numberText(device.health_score, 0)}
                label={`健康评分 ${numberText(device.health_score, 0)} / 100`}
              />
            </strong>
            <div>
              <span>/ 100</span>
              <small>目录健康评分</small>
            </div>
          </div>
          <div className="current-device__update">
            目录更新 {formatTime(device.last_updated)}
          </div>
          {outsideFilter && (
            <p className="factory-note">当前选中不在筛选结果中</p>
          )}
          {activeEvent && (
            <button
              type="button"
              className="current-device__event"
              onClick={onOpenEvent}
            >
              事件 #{activeEvent.id} 待处置 ›
            </button>
          )}
          <div className="current-device__actions">
            <Button onClick={onAnalyze}>设备分析</Button>
            <Button type="primary" onClick={onDiagnose}>
              智能诊断
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

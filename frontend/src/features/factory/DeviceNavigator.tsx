import { useDeviceVisual } from './growth/DeviceVisualProvider'
import DeviceIcon from './growth/DeviceIcon'
import { Empty, Input } from 'antd'
import { useRef } from 'react'
import FlipSelection from '../../motion/FlipSelection'
import FlipValue from '../../motion/FlipValue'
import FlipText from '../../motion/FlipText'
import { STATUS_META } from '../../components/BusinessUI'
import type { Device } from '../../services/api'

export default function DeviceNavigator({
  devices,
  total,
  selectedId,
  keyword,
  onKeyword,
  onSelect,
  selectedOutsideFilter,
}: {
  devices: Device[]
  total: number
  selectedId?: string
  keyword: string
  onKeyword: (value: string) => void
  onSelect: (id: string) => void
  selectedOutsideFilter: boolean
}) {
  const visual = useDeviceVisual()
  const list = useRef<HTMLDivElement>(null)
  return (
    <section className="factory-panel factory-panel--devices" aria-label="设备导航">
      <header className="factory-panel__head">
        <h2>设备</h2>
        <span className="factory-panel__count">
          <FlipValue value={`${devices.length}/${total}`} />
        </span>
      </header>
      <Input
        size="small"
        allowClear
        value={keyword}
        placeholder="搜索名称或编号"
        aria-label="搜索设备"
        onChange={(event) => onKeyword(event.target.value)}
      />
      {selectedOutsideFilter && (
        <p className="factory-note">当前选中不在筛选结果中</p>
      )}
      <div ref={list} className="device-nav" role="listbox" aria-label="设备列表">
        <FlipSelection container={list} identity={`${selectedId ?? "none"}:${devices.map(d => d.id).join("|")}`} />
        {!devices.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword ? '没有匹配设备' : '该状态下暂无设备'}
          />
        ) : (
          devices.map((device) => (
            <button
              key={device.id}
              data-pico-entity-id={device.id}
              type="button"
              role="option"
              aria-selected={device.id === selectedId}
              className={`device-nav__item ${device.id === selectedId ? 'is-selected' : ''}`}
              onClick={() => onSelect(device.id)}
              title={`${device.name} · ${device.id}`}
            >
              <span className="device-nav__identity">
                <i
                  style={{ background: STATUS_META[device.status]?.hex }}
                  aria-hidden
                />
                <DeviceIcon icon={visual.get(device).iconKey} color={visual.get(device).accentColor} />
                <span className="device-nav__name"><FlipText value={visual.get(device).displayAlias ?? device.name} /></span>
              </span>

            </button>
          ))
        )}
      </div>
    </section>
  )
}

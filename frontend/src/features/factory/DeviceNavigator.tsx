import { Empty, Input } from 'antd'
import { numberText, STATUS_META } from '../../components/BusinessUI'
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
  return (
    <section className="factory-panel factory-panel--devices" aria-label="设备导航">
      <header className="factory-panel__head">
        <h2>设备</h2>
        <span className="factory-panel__count">
          {devices.length}/{total}
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
      <div className="device-nav" role="listbox" aria-label="设备列表">
        {!devices.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword ? '没有匹配设备' : '该状态下暂无设备'}
          />
        ) : (
          devices.map((device) => (
            <button
              key={device.id}
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
                <span className="device-nav__name">{device.name}</span>
              </span>
              <span className="device-nav__score">
                {numberText(device.health_score, 0)}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  )
}

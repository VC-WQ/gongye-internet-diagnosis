import { useEffect, useState, type ComponentType } from 'react'
import type { Device } from '../../../services/api'
import type { DeviceSceneBridge } from './DeviceSceneBridge'

export interface GrowthLayerProps {
  bridge: DeviceSceneBridge
  devices: Device[]
  selected?: string
  visibleIds: ReadonlySet<string>
}

/** No Three import/context until an actual visible device is selected. */
export default function DeviceGrowthHost(props: GrowthLayerProps) {
  const [Layer, setLayer] = useState<ComponentType<GrowthLayerProps> | null>(null)
  const [failed, setFailed] = useState(false)
  const wanted = Boolean(props.selected && props.visibleIds.has(props.selected) && props.devices.some(d => d.id === props.selected))
  useEffect(() => {
    if (Layer || !wanted) return
    let current = true
    setFailed(false)
    void import('./DeviceGrowthLayer').then(module => {
      if (current) setLayer(() => module.default)
    }).catch(() => { if (current) setFailed(true) })
    return () => { current = false }
  }, [Layer, wanted])
  return Layer ? <Layer {...props} /> : failed && wanted ? <div className="device-growth__unavailable" role="status">
    三维资源暂不可用，设备平面视图仍可使用。<button type="button" onClick={() => location.reload()}>重新加载页面</button>
  </div> : null
}

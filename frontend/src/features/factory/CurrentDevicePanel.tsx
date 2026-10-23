import { useRef } from 'react'
import { Button } from 'antd'
import { formatTime, numberText, STATUS_META, StatusTag, TYPE_LABEL } from '../../components/BusinessUI'
import type { Device } from '../../services/api'
import FlipValue from '../../motion/FlipValue'
import { useContentTransition } from '../../motion/useContentTransition'

export default function CurrentDevicePanel({ device, devices, outsideFilter, onAnalyze, onDiagnose }: {
  device?: Device; devices: Device[]; outsideFilter: boolean; onAnalyze: () => void; onDiagnose: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useContentTransition(device?.id, bodyRef)
  return <section className="factory-panel factory-panel--current" aria-label={device ? '当前设备' : '工厂概况'}>
    <header className="factory-panel__head"><h2>{device ? '当前设备' : '工厂概况'}</h2>{device && <StatusTag status={device.status} />}</header>
    <div className="current-device__body" ref={bodyRef}>
      {!device ? <><div className="current-device__name">全厂设备态势</div><p className="factory-note">当前未选择设备。选择场景模型或目录设备后，查看对应摘要与实时采样。</p>
        <div className="current-device__health"><strong><FlipValue value={String(devices.length)} /></strong><span>台登记设备</span></div>
        <p className="factory-note">状态数量来自设备目录；未将缺失采样当作正常运行。</p></>
      : <><div className="current-device__name">{device.name}</div>
        <div className="current-device__meta">{device.id} · {TYPE_LABEL[device.device_type] ?? device.device_type}</div>
        <div className="current-device__health"><strong style={{ color: STATUS_META[device.status]?.hex }}><FlipValue value={numberText(device.health_score, 0)} /></strong><span>/ 100 · 目录健康评分</span></div>
        <p className="current-device__updated">目录更新 {formatTime(device.last_updated)}</p>
        {outsideFilter && <p className="factory-note">当前设备不在筛选结果中，已保留选中状态。</p>}
        <div className="current-device__actions"><Button onClick={onAnalyze}>设备详情</Button><Button type="primary" onClick={onDiagnose}>智能诊断</Button></div></>}
    </div>
  </section>
}

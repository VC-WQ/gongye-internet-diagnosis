import { useEffect, useState } from 'react'
import { Button, Input, Popover, message } from 'antd'
import type { Device } from '../../../services/api'
import { useDeviceVisual } from './DeviceVisualProvider'
import DeviceIcon from './DeviceIcon'
import { ACCENTS, ICON_KEYS, type VisualChoice } from './visualConfig'
import './deviceGrowth.css'

const LABELS = { compressor: '压缩机', pump: '泵', motor: '电机', machine: '通用设备' }
export default function DeviceAppearanceEditor({ device }: { device: Device }) {
  const visual = useDeviceVisual()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<VisualChoice>(() => visual.get(device))
  const [error, setError] = useState('')
  useEffect(() => { setOpen(false); setError('') }, [device.id])
  const begin = (next: boolean) => { if (next) { setDraft(visual.get(device)); setError('') }; setOpen(next) }
  return <Popover open={open} onOpenChange={begin} trigger="click" placement="bottomRight" content={
    <form className="device-appearance" aria-label="设备外观设置" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}
      onSubmit={e => { e.preventDefault(); try { const savedScope = visual.save(device.id, draft); setOpen(false); message.success(savedScope === 'browser' ? '展示外观已保存到当前浏览器' : '浏览器存储不可用，外观仅本次会话生效') } catch (e) { setError(e instanceof Error ? e.message : '外观设置无效') } }}>
      <header><strong>外观设置</strong><span>{device.id}</span></header>
      <p>仅调整展示，不修改设备名称、类型或运行状态。</p>
      <label htmlFor="device-display-alias">展示别名</label>
      <Input id="device-display-alias" value={draft.displayAlias ?? ''} placeholder={device.name} maxLength={48}
        onChange={e => setDraft({ ...draft, displayAlias: e.target.value })} />
      <small>留空使用真实名称；2–24 个字符。</small>
      <fieldset><legend>设备图标</legend><div className="device-appearance__icons">
        {ICON_KEYS.map(icon => <button key={icon} type="button" aria-label={LABELS[icon]} aria-pressed={draft.iconKey === icon}
          onClick={() => setDraft({ ...draft, iconKey: icon })}><DeviceIcon icon={icon} /><span>{LABELS[icon]}</span></button>)}
      </div></fieldset>
      <fieldset><legend>识别色</legend><div className="device-appearance__colors">
        {ACCENTS.map(color => <button type="button" key={color} style={{ background: color }} aria-label={`识别色 ${color}`}
          aria-pressed={draft.accentColor.toUpperCase() === color} onClick={() => setDraft({ ...draft, accentColor: color })} />)}
        <input type="color" aria-label="自定义识别色" value={/^#[0-9a-f]{6}$/i.test(draft.accentColor) ? draft.accentColor : ACCENTS[0]}
          onChange={e => setDraft({ ...draft, accentColor: e.target.value })} />
      </div></fieldset>
      {error && <p className="device-appearance__error" role="alert">{error}</p>}
      <small role="status">{visual.scope === 'browser' ? '仅此账户在当前浏览器生效，不跨端同步。' : '浏览器存储不可用，仅本次会话生效。'}</small>
      <footer><Button onClick={() => {
        try { const savedScope = visual.reset(device.id); setOpen(false); if (savedScope === 'session') message.info('浏览器存储不可用，仅本次会话恢复默认') }
        catch (e) { setError(e instanceof Error ? e.message : '暂时无法恢复外观') }
      }}>恢复默认</Button><Button type="primary" htmlType="submit">保存外观</Button></footer>
    </form>}>
    <Button size="small">外观设置</Button>
  </Popover>
}

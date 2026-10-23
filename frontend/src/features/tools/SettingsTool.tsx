import { Card } from 'antd'
import { useUiPreferences } from '../../services/uiPrefs'
import SlidingChoice from '../../components/SlidingChoice'
import './tools.css'

export default function SettingsTool() {
  const { theme, setTheme } = useUiPreferences()
  return <Card title="界面偏好" className="settings-card">
    <p className="settings-note">主题保存在本机浏览器，刷新后保持；不影响业务数据。</p>
    <SlidingChoice value={theme} onChange={setTheme} label="界面主题"
      options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} />
  </Card>
}

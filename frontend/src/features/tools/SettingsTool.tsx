import { Button, Card } from 'antd'
import { useUiPreferences } from '../../services/uiPrefs'
import './tools.css'

export default function SettingsTool() {
  const { theme, setTheme } = useUiPreferences()
  return (
    <>
      <Card title="界面偏好" className="settings-card">
        <p className="settings-note">
          主题保存在本机浏览器，刷新后保持；不影响业务数据。
        </p>
        <div className="theme-choice" role="group" aria-label="界面主题">
          <Button
            type={theme === 'light' ? 'primary' : 'default'}
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          >
            浅色
          </Button>
          <Button
            type={theme === 'dark' ? 'primary' : 'default'}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          >
            深色
          </Button>
        </div>
      </Card>
    </>
  )
}

import { Button, Card } from 'antd'
import { useLayoutEffect, useRef } from 'react'
import { useUiPreferences } from '../../services/uiPrefs'
import './tools.css'

export default function SettingsTool() {
  const { theme, setTheme, reducedMotion } = useUiPreferences()
  const rail = useRef<HTMLDivElement>(null), indicator = useRef<HTMLSpanElement>(null)
  const animation = useRef<Animation>()
  useLayoutEffect(() => {
    const root = rail.current!, node = indicator.current!
    const update = () => {
      const selected = root.querySelector<HTMLElement>('[aria-pressed=true]')!
      const from = node.getBoundingClientRect(), parent = root.getBoundingClientRect()
      animation.current?.cancel()
      const x = selected.offsetLeft, width = selected.offsetWidth
      node.style.width = `${width}px`; node.style.transform = `translateX(${x}px)`
      if (!reducedMotion && from.width && node.animate) {
        animation.current = node.animate([
          { transform: `translateX(${from.left - parent.left - root.clientLeft}px)`, width: `${from.width}px` },
          { transform: `translateX(${x}px)`, width: `${width}px` },
        ], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }
    update()
    const observer = new ResizeObserver(update); observer.observe(root)
    return () => observer.disconnect()
  }, [theme, reducedMotion])
  useLayoutEffect(() => () => animation.current?.cancel(), [])
  return <Card title="界面偏好" className="settings-card">
    <p className="settings-note">主题保存在本机浏览器，刷新后保持；不影响业务数据。</p>
    <div ref={rail} className="theme-choice" role="group" aria-label="界面主题">
      <span ref={indicator} className="theme-choice__indicator" data-theme-indicator aria-hidden="true" />
      {(['light', 'dark'] as const).map(value => <Button key={value} aria-pressed={theme === value}
        onClick={() => setTheme(value)}>{value === 'light' ? '浅色' : '深色'}</Button>)}
    </div>
  </Card>
}

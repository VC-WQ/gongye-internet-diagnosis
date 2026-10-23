import { Tooltip } from 'antd'
import { usePico } from '../core/PicoProvider'

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 8c2.6 2 2.6 6 0 8" />
      <path d="M18.8 5.2c4.4 3.6 4.4 10 0 13.6" opacity=".65" />
    </svg>
  )
}

export default function PicoHeader({
  variant,
  showClose,
  avatar,
}: {
  variant: 'dock' | 'workbench'
  showClose?: boolean
  avatar?: React.ReactNode
}) {
  const {
    contextTitle,
    autoRead,
    setAutoRead,
    speechAvailable,
    setOpen,
  } = usePico()
  return (
    <header className={`pico-header pico-header--${variant}`}>
      {avatar && <span className="pico-header__avatar">{avatar}</span>}
      <div className="pico-header__identity">
        <strong>Pico</strong>
        <span className="pico-header__context" title={contextTitle}>
          {contextTitle}
        </span>
      </div>
      <div className="pico-header__actions">
        <Tooltip
          title={speechAvailable ? '自动朗读' : '当前浏览器不支持语音'}
        >
          <button
            type="button"
            className={`pico-icon-button ${autoRead ? 'is-active' : ''}`}
            aria-label="自动朗读"
            aria-pressed={autoRead}
            disabled={!speechAvailable}
            onClick={() => setAutoRead(!autoRead)}
          >
            <SpeakerIcon />
          </button>
        </Tooltip>
        {showClose && (
          <button
            type="button"
            className="pico-icon-button"
            aria-label="关闭 Pico"
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
    </header>
  )
}

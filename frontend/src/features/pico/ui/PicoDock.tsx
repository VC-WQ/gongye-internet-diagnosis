import { useEffect } from 'react'
import { usePico } from '../core/PicoProvider'
import PicoAvatar from './PicoAvatar'
import PicoPanel from './PicoPanel'
import '../pico.css'

export default function PicoDock() {
  const { open, setOpen, toggle, unread, emotion } = usePico()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <div className={`pico-dock ${open ? 'is-open' : ''}`}>
      {open && <PicoPanel />}
      <button
        type="button"
        className="pico-orb"
        aria-label={open ? '收起 Pico 助手' : '打开 Pico 助手'}
        aria-expanded={open}
        onClick={toggle}
      >
        <PicoAvatar emotion={emotion} size={open ? 44 : 76} />
        {!open && unread && <span className="pico-orb__badge" />}
        <span className="pico-orb__label">Pico</span>
      </button>
    </div>
  )
}

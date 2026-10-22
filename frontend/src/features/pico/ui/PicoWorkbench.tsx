import { Suspense, lazy, useEffect, useState, type CSSProperties } from 'react'
import { usePico } from '../core/PicoProvider'
import PicoHeader from './PicoHeader'
import PicoConversation from './PicoConversation'
import PicoLab, { type PicoPresentation } from './PicoLab'
import '../pico.css'
import './workbench.css'

const PicoAvatar = lazy(() => import('./PicoAvatar'))

export default function PicoWorkbench() {
  const { setWorkbenchActive, emotion, reaction, react } = usePico()
  const [presentation, setPresentation] = useState<PicoPresentation>({ size: 84, rotation: 0, speed: 1 })
  useEffect(() => {
    setWorkbenchActive(true)
    return () => setWorkbenchActive(false)
  }, [setWorkbenchActive])
  return (
    <section className="pico-workbench" aria-label="Pico 数字伴侣" onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) react('attention') }}
      style={{ '--pico-preview-size': `${presentation.size}px` } as CSSProperties}>
      <PicoHeader
        variant="workbench"
        avatar={
          <Suspense fallback={null}>
            <PicoAvatar emotion={emotion} reaction={reaction} {...presentation} />
          </Suspense>
        }
      />
      <PicoConversation variant="workbench" active />
      {import.meta.env.DEV && <PicoLab presentation={presentation} onPresentation={setPresentation} />}
    </section>
  )
}

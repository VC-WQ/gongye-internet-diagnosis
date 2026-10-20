import { Suspense, lazy, useEffect } from 'react'
import { usePico } from '../core/PicoProvider'
import PicoHeader from './PicoHeader'
import PicoConversation from './PicoConversation'
import PicoLab from './PicoLab'
import '../pico.css'
import './workbench.css'

const PicoAvatar = lazy(() => import('./PicoAvatar'))

export default function PicoWorkbench() {
  const { setWorkbenchActive, emotion } = usePico()
  useEffect(() => {
    setWorkbenchActive(true)
    return () => setWorkbenchActive(false)
  }, [setWorkbenchActive])
  return (
    <section className="pico-workbench" aria-label="Pico 数字伴侣">
      <PicoHeader
        variant="workbench"
        avatar={
          <Suspense fallback={null}>
            <PicoAvatar emotion={emotion} size={84} />
          </Suspense>
        }
      />
      <PicoConversation variant="workbench" active />
      {import.meta.env.DEV && <PicoLab />}
    </section>
  )
}

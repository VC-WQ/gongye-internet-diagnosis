import { useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useSpatialNavigate } from '../../../hooks/useSpatialNavigate'
import { useUiPreferences } from '../../../services/uiPrefs'
import { useWorkspace } from '../../../services/workspace'
import { getDevice, getEvent, getMe } from '../../../services/api'
import { deviceFormDraftChannel } from '../../management/deviceFormDraft'
import { PicoActionExecutor } from './PicoActionExecutor'

export function usePicoActionExecutor(key: string, open: boolean, setOpen: (value: boolean) => void) {
  const location = useLocation()
  const workspace = useWorkspace()
  const preferences = useUiPreferences()
  const navigate = useSpatialNavigate()
  const current = useRef({ key, url: location.pathname + location.search, theme: preferences.theme, dockOpen: open, deviceId: workspace.selectedDeviceId })
  current.current = { key, url: location.pathname + location.search, theme: preferences.theme, dockOpen: open, deviceId: workspace.selectedDeviceId }
  const functions = useRef({ navigate, setOpen, setTheme: preferences.setTheme })
  functions.current = { navigate, setOpen, setTheme: preferences.setTheme }
  const executor = useRef<PicoActionExecutor>()
  if (!executor.current) executor.current = new PicoActionExecutor({
    current: () => ({ ...current.current, theme: document.documentElement.dataset.theme ?? '' }),
    navigate: path => functions.current.navigate(path),
    setTheme: theme => functions.current.setTheme(theme),
    closeDock: () => functions.current.setOpen(false),
    getDevice, getEvent, getMe,
    offerDraft: (draft, signal) => deviceFormDraftChannel.offer(draft, signal),
  })
  return executor.current
}

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
  const state = {
    key, url: location.pathname + location.search, locationKey: location.key,
    navigationMarker: typeof location.state?.picoExecution === 'string' ? location.state.picoExecution : undefined,
    theme: preferences.theme, dockOpen: open, deviceId: workspace.selectedDeviceId, eventId: workspace.selectedEventId,
  }
  const current = useRef(state)
  current.current = state
  const functions = useRef({ navigate, setOpen, setTheme: preferences.setTheme })
  functions.current = { navigate, setOpen, setTheme: preferences.setTheme }
  const executor = useRef<PicoActionExecutor>()
  if (!executor.current) executor.current = new PicoActionExecutor({
    current: () => ({ ...current.current, sessionToken: localStorage.getItem('token'), theme: document.documentElement.dataset.theme ?? '' }),
    navigate: (path, marker, signal) => functions.current.navigate(path, { state: { picoExecution: marker }, signal }),
    setTheme: theme => functions.current.setTheme(theme),
    closeDock: () => functions.current.setOpen(false),
    getDevice, getEvent, getMe,
    offerDraft: (draft, signal) => deviceFormDraftChannel.offer(draft, signal),
    factoryDeviceVisible: id => Array.from(document.querySelectorAll('[role="listbox"] [data-pico-entity-id]')).some(node => node.getAttribute('data-pico-entity-id') === id && !node.closest('[hidden], [inert]')),
  })
  return executor.current
}

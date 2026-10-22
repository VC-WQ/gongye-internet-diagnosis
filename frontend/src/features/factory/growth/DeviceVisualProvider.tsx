import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Device } from '../../../services/api'
import { appearanceKey, defaultVisual, validateVisual, type VisualChoice, type VisualChoices } from './visualConfig'

type Scope = 'browser' | 'session'
interface VisualContextValue {
  choices: VisualChoices
  scope: Scope
  get: (device: Device) => VisualChoice
  save: (id: string, value: unknown) => Scope
  reset: (id: string) => Scope
}
const Context = createContext<VisualContextValue | null>(null)

/** Verified account + auth-session scope; each device has its own storage key. */
export function DeviceVisualProvider({ userId, sessionToken, children }: { userId: number; sessionToken: string | null; children: ReactNode }) {
  const prefix = appearanceKey(userId, location.origin) + '/device/'
  const [initial] = useState(() => {
    const choices: VisualChoices = Object.create(null)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith(prefix)) continue
        try {
          const id = decodeURIComponent(key.slice(prefix.length))
          if (id && id.length <= 256) choices[id] = validateVisual(JSON.parse(localStorage.getItem(key)!))
        } catch { /* A corrupt entry cannot invalidate other devices. */ }
      }
      return { choices, scope: 'browser' as Scope }
    } catch { return { choices, scope: 'session' as Scope } }
  })
  const [choices, setChoices] = useState(initial.choices)
  const [scope, setScope] = useState<Scope>(initial.scope)
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (localStorage.getItem('token') !== sessionToken || !event.key?.startsWith(prefix)) return
      try {
        const id = decodeURIComponent(event.key.slice(prefix.length))
        const value = event.newValue ? validateVisual(JSON.parse(event.newValue)) : undefined
        setChoices(previous => { const next = { ...previous }; if (value) next[id] = value; else delete next[id]; return next })
      } catch { /* Keep the last valid local view for a malformed external value. */ }
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [prefix, sessionToken])
  const value = useMemo<VisualContextValue>(() => {
    const persist = (id: string, choice?: VisualChoice): Scope => {
      if (localStorage.getItem('token') !== sessionToken) throw new Error('账户已切换，请重新进入后再设置外观')
      let nextScope: Scope = 'browser'
      try {
        const key = prefix + encodeURIComponent(id)
        if (choice) localStorage.setItem(key, JSON.stringify(choice))
        else localStorage.removeItem(key)
      } catch { nextScope = 'session' }
      setScope(nextScope)
      setChoices(previous => { const next = { ...previous }; if (choice) next[id] = choice; else delete next[id]; return next })
      return nextScope
    }
    return { choices, scope,
      get: device => Object.prototype.hasOwnProperty.call(choices, device.id) ? choices[device.id] : defaultVisual(device.device_type),
      save: (id, input) => persist(id, validateVisual(input)),
      reset: id => persist(id),
    }
  }, [choices, prefix, scope, sessionToken])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useDeviceVisual() {
  const value = useContext(Context)
  if (!value) throw new Error('DeviceVisualProvider is required')
  return value
}

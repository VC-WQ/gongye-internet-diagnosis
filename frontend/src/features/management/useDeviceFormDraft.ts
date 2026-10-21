import { useSyncExternalStore } from 'react'
import { deviceFormDraftChannel } from './deviceFormDraft'

export function useDeviceFormDraft(mode: 'create' | 'edit', deviceId?: string) {
  const entry = useSyncExternalStore(deviceFormDraftChannel.subscribe, deviceFormDraftChannel.getSnapshot, () => undefined)
  const draft = entry?.mode === mode && (mode === 'create' || entry.deviceId === deviceId) ? entry : undefined
  // Lifetime belongs to the executor/route and the explicit editor close handler.
  // Effect cleanup here would discard a valid first draft during StrictMode's mount check.
  return draft
}

import type { PicoDeviceFields } from '../pico/core/types'

export interface DeviceFormDraft {
  actionId: string
  mode: 'create' | 'edit'
  deviceId?: string
  fields: PicoDeviceFields
}
export interface DeviceFormAck { missing: string[] }

const cancelled = (message: string) => Object.assign(new Error(message), { name: 'AbortError' })

/** One ephemeral hand-off to the existing editor. No storage and no business writes. */
export class DeviceFormDraftChannel {
  private draft?: DeviceFormDraft
  private listeners = new Set<() => void>()
  private pending?: { id: string; resolve: (value: DeviceFormAck) => void; reject: (error: Error) => void; cleanup: () => void }
  getSnapshot = () => this.draft
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { this.listeners.forEach(listener => listener()) }

  offer(draft: DeviceFormDraft, signal: AbortSignal, timeout = 6000): Promise<DeviceFormAck> {
    this.clear()
    if (signal.aborted) return Promise.reject(cancelled('页面操作已取消。'))
    return new Promise((resolve, reject) => {
      const abort = () => this.release(draft.actionId, '页面已变化，未继续填入旧表单。')
      const timer = setTimeout(() => this.release(draft.actionId, '设备表单未准备完成，请重试。', false), timeout)
      signal.addEventListener('abort', abort, { once: true })
      this.pending = { id: draft.actionId, resolve, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', abort) } }
      this.draft = draft
      this.emit()
    })
  }

  acknowledge(actionId: string, value: DeviceFormAck): void {
    if (this.pending?.id !== actionId) return
    const pending = this.pending
    this.pending = undefined
    pending.cleanup()
    pending.resolve(value)
    // Keep the same draft identity until the editor closes; refreshes cannot reapply it.
  }

  release(actionId: string, reason = '设备表单已关闭。', isCancellation = true): void {
    if (this.draft?.actionId !== actionId) return
    if (this.pending?.id === actionId) {
      const pending = this.pending
      this.pending = undefined
      pending.cleanup()
      pending.reject(isCancellation ? cancelled(reason) : new Error(reason))
    }
    this.draft = undefined
    this.emit()
  }

  clear(): void { if (this.draft) this.release(this.draft.actionId) }
}

export const deviceFormDraftChannel = new DeviceFormDraftChannel()

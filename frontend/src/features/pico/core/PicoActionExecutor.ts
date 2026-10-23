import { parsePicoUiAction, picoUiActionPath, PicoActionRegistry, PicoExecutionGuard } from './uiActions'
import type { PicoActionResult } from './types'
import type { DeviceFormAck, DeviceFormDraft } from '../../management/deviceFormDraft'

interface State { key: string; url: string; theme: string; dockOpen: boolean; deviceId?: string }
export interface PicoExecutorDependencies {
  current: () => State
  navigate: (path: string) => void
  setTheme: (theme: 'light' | 'dark') => void
  closeDock: () => void
  getMe: (signal?: AbortSignal) => Promise<{ role: string; is_active: boolean }>
  getDevice: (id: string, signal?: AbortSignal) => Promise<{ id: string }>
  getEvent: (id: number, signal?: AbortSignal) => Promise<{ id: number; device_id: string }>
  offerDraft: (draft: DeviceFormDraft, signal: AbortSignal) => Promise<DeviceFormAck>
}

const aborted = () => Object.assign(new Error('本次操作已取消，未继续执行。'), { name: 'AbortError' })

function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop) }
    const stop = () => { cleanup(); reject(aborted()) }
    if (signal.aborted) { stop(); return }
    signal.addEventListener('abort', stop, { once: true })
    timer = setTimeout(() => { cleanup(); reject(new Error('权限或目标数据校验未能及时完成，请重试。')) }, 6000)
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

/** Small injected executor: no DOM automation and no write API exists in its dependencies. */
export class PicoActionExecutor {
  private registry = new PicoActionRegistry()
  constructor(private deps: PicoExecutorDependencies) {}

  async execute(raw: unknown, signal: AbortSignal, guard: PicoExecutionGuard): Promise<PicoActionResult> {
    const action = parsePicoUiAction(raw)
    if (!action) return { action_id: 'invalid', status: 'rejected', message: '页面操作参数不符合平台允许的格式，未执行。' }
    if (!this.registry.claim(action.action_id)) return { action_id: action.action_id, status: 'rejected', message: '这项操作已经处理，不会重复执行。' }
    const check = () => {
      const state = this.deps.current()
      if (signal.aborted || !guard.accept(state.key, state.url)) throw aborted()
    }
    const wait = (predicate: () => boolean, timeout = 6000) => new Promise<void>((resolve, reject) => {
      const start = Date.now()
      let timer: ReturnType<typeof setTimeout>
      const done = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', stop); error ? reject(error) : resolve() }
      const stop = () => done(aborted())
      const tick = () => {
        try {
          check()
          if (predicate()) { done(); return }
          if (Date.now() - start >= timeout) { done(new Error('页面未能完成操作，请重试。')); return }
          timer = setTimeout(tick, 32)
        } catch (error) { done(error instanceof Error ? error : new Error('页面操作失败。')) }
      }
      signal.addEventListener('abort', stop, { once: true })
      // Allow React effects (and the dock scroll-lock cleanup) to commit first.
      timer = setTimeout(tick, 32)
    })
    const navigate = async (path: string, deviceId?: string) => {
      check()
      guard.target = path
      this.deps.navigate(path)
      await wait(() => this.deps.current().url === path && (!deviceId || this.deps.current().deviceId === deviceId))
    }
    try {
      check()
      const admin = action.type === 'prefill_device_form' || (action.type === 'navigate' && (action.route_id === 'device_management' || (action.route_id === 'tools' && action.params.tool === 'simulation')))
      if (admin) {
        const user = await bounded(this.deps.getMe(signal), signal)
        check()
        if (!user.is_active || user.role !== 'admin') throw new Error('当前账号没有设备管理权限，未打开或填写表单。')
      }
      let message: string
      if (action.type === 'set_theme') {
        this.deps.setTheme(action.theme)
        await wait(() => this.deps.current().theme === action.theme)
        message = `已切换为${action.theme === 'dark' ? '深色' : '浅色'}主题。`
      } else if (action.type === 'navigate') {
        if (action.route_id === 'device_detail') {
          const target = await bounded(this.deps.getDevice(action.params.device_id, signal), signal)
          if (target.id !== action.params.device_id) throw new Error('设备身份不匹配，未打开其他设备。')
        } else if (action.route_id === 'event_detail' || action.route_id === 'report') {
          const event = await bounded(this.deps.getEvent(action.params.event_id, signal), signal)
          if (event.id !== action.params.event_id || (action.params.device_id && event.device_id !== action.params.device_id)) throw new Error('事件身份不匹配，未打开其他记录。')
        }
        const path = picoUiActionPath(action)
        await navigate(path, action.route_id === 'device_detail' ? action.params.device_id : undefined)
        const names = { factory: '工厂', tools: '工具页面', research: '研究中心', device_detail: '设备详情', event_detail: '诊断记录', report: '事件报告', device_management: '设备管理', records: '诊断记录列表' }
        message = `已打开${names[action.route_id]}。`
      } else {
        if (action.mode === 'edit') {
          const target = await bounded(this.deps.getDevice(action.device_id!, signal), signal)
          if (target.id !== action.device_id) throw new Error('设备身份不匹配，未填写其他设备。')
        }
        check()
        this.deps.closeDock()
        await wait(() => !this.deps.current().dockOpen)
        await navigate(action.mode === 'create' ? '/admin/devices' : `/manage/devices/${encodeURIComponent(action.device_id!)}`, action.mode === 'edit' ? action.device_id : undefined)
        check()
        const ack = await this.deps.offerDraft({ actionId: action.action_id, mode: action.mode, deviceId: action.device_id, fields: action.fields }, signal)
        check()
        message = '已打开设备表单并预填你提供的字段，尚未保存。请检查后自行保存。' + (ack.missing.length ? `还需补充${ack.missing.join('、')}。` : '')
      }
      return { action_id: action.action_id, status: 'succeeded', message }
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError')
      // API errors may contain transport internals; show an actionable, bounded message.
      const message = cancelled ? '本次操作已取消，未继续执行。' : error instanceof Error && !('isAxiosError' in error) ? error.message : '目标不存在、不可见或页面暂不可用，操作没有完成。'
      return { action_id: action.action_id, status: cancelled ? 'cancelled' : 'failed', message }
    }
  }
}

import { parsePicoUiAction, picoUiActionPath, PicoActionRegistry, PicoExecutionGuard, picoNavigationIdentity, type PicoExecutionState } from './uiActions'
import type { PicoActionResult, PicoUiAction } from './types'
import type { DeviceFormAck, DeviceFormDraft } from '../../management/deviceFormDraft'

interface State extends PicoExecutionState { theme: string; dockOpen: boolean }
export interface PicoExecutorDependencies {
  current: () => State
  navigate: (path: string, marker: string, signal: AbortSignal) => void
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

/** Injected, bounded UI executor. Its dependencies expose no business write API. */
export class PicoActionExecutor {
  private registry = new PicoActionRegistry()
  private navigationSequence = 0
  constructor(private deps: PicoExecutorDependencies) {}
  currentState = (): PicoExecutionState => ({ ...this.deps.current() })

  async execute(raw: unknown, signal: AbortSignal, guard: PicoExecutionGuard): Promise<PicoActionResult> {
    return (await this.executeSequence([raw], signal, guard))[0]
  }

  /** Validate the whole batch before any side effect; fail once, never continue later steps. */
  async executeSequence(
    raw: unknown, signal: AbortSignal, guard: PicoExecutionGuard,
    onProgress?: (results: PicoActionResult[]) => void,
  ): Promise<PicoActionResult[]> {
    const rejected = (message: string): PicoActionResult[] => [{ action_id: 'invalid', status: 'rejected', message }]
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) return rejected('页面操作数量不符合要求，一次最多执行三步，未执行。')
    const actions = raw.map(parsePicoUiAction)
    if (actions.some(action => !action)) return rejected('页面操作参数不符合平台允许的格式，整组操作未执行。')
    const valid = actions as PicoUiAction[]
    if (valid.some((action, index) => action.type === 'prefill_device_form' && index !== valid.length - 1)) return rejected('表单预填必须是最后一步，整组操作未执行，以便保留表单供你检查。')
    if (!this.registry.claimAll(valid.map(action => action.action_id))) return rejected('操作标识重复或已经处理，整组操作未执行。')
    const controller = new AbortController()
    const stop = () => controller.abort()
    if (signal.aborted) stop()
    else signal.addEventListener('abort', stop, { once: true })
    let expired = false
    const budget = setTimeout(() => { expired = true; controller.abort() }, 24000)
    const results: PicoActionResult[] = []
    try {
      for (let index = 0; index < valid.length; index++) {
        const action = valid[index]
        onProgress?.([...results, { action_id: action.action_id, status: 'running', message: `正在执行第 ${index + 1} 步…` }])
        let result = await this.executeStep(action, controller.signal, guard)
        if (expired) result = { action_id: action.action_id, status: 'failed', message: '页面操作超过时间限制，已停止剩余步骤。' }
        results.push(result)
        if (result.status !== 'succeeded') {
          valid.slice(index + 1).forEach(next => results.push({ action_id: next.action_id, status: 'cancelled', message: '前一步未完成，本步未执行。' }))
          break
        }
        onProgress?.([...results])
      }
      onProgress?.([...results])
      return results
    } finally {
      clearTimeout(budget)
      signal.removeEventListener('abort', stop)
    }
  }

  private async executeStep(action: PicoUiAction, signal: AbortSignal, guard: PicoExecutionGuard): Promise<PicoActionResult> {
    const check = () => {
      if (signal.aborted || !guard.accept(this.deps.current())) throw aborted()
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
      if (signal.aborted) { stop(); return }
      signal.addEventListener('abort', stop, { once: true })
      timer = setTimeout(tick, 32)
    })
    const navigate = async (path: string) => {
      check()
      const identity = picoNavigationIdentity(path)
      const arrived = () => {
        const state = this.deps.current()
        return state.url === path && state.deviceId === identity.deviceId && state.eventId === identity.eventId
      }
      if (arrived()) { await wait(arrived); return }
      const marker = `${action.action_id}-${++this.navigationSequence}`
      guard.beginNavigation(path, marker)
      this.deps.navigate(path, marker, signal)
      // Workspace increments contextRevision in an effect after the Router render.
      // Require two stable polls before consuming the one self-navigation ticket.
      let stableKey: string | undefined
      await wait(() => {
        const state = this.deps.current()
        if (!arrived() || state.navigationMarker !== marker) return false
        if (stableKey !== state.key) { stableKey = state.key; return false }
        return true
      })
      if (!guard.completeNavigation(this.deps.current())) throw aborted()
    }
    try {
      check()
      // Every step revalidates the authenticated server account; client role is never authority.
      const user = await bounded(this.deps.getMe(signal), signal)
      check()
      if (!user.is_active) throw new Error('当前账号不可用，本步未执行。')
      const admin = action.type === 'prefill_device_form' || (action.type === 'navigate' && (action.route_id === 'device_management' || (action.route_id === 'tools' && action.params.tool === 'simulation')))
      if (admin && user.role !== 'admin') throw new Error('当前账号没有此管理操作的权限，本步未执行。')
      let message: string
      if (action.type === 'set_theme') {
        this.deps.setTheme(action.theme)
        await wait(() => this.deps.current().theme === action.theme)
        message = `已切换为${action.theme === 'dark' ? '深色' : '浅色'}主题。`
      } else if (action.type === 'navigate') {
        const deviceId = action.route_id === 'device_detail' || action.route_id === 'records' || action.route_id === 'tools' ? action.params.device_id : undefined
        if (deviceId) {
          const target = await bounded(this.deps.getDevice(deviceId, signal), signal)
          check()
          if (target.id !== deviceId) throw new Error('设备身份不匹配，未打开其他设备。')
        }
        if (action.route_id === 'event_detail' || action.route_id === 'report') {
          const event = await bounded(this.deps.getEvent(action.params.event_id, signal), signal)
          check()
          if (event.id !== action.params.event_id || (action.params.device_id && event.device_id !== action.params.device_id)) throw new Error('事件身份不匹配，未打开其他记录。')
        }
        await navigate(picoUiActionPath(action))
        const names = { factory: '工厂', tools: '工具页面', research: '研究中心', device_detail: '设备详情', event_detail: '诊断记录', report: '事件报告', device_management: '设备管理', records: '诊断记录列表' }
        message = `已打开${names[action.route_id]}。`
        if (action.route_id === 'tools' && action.params.tool === 'diagnosis') message = '已打开智能诊断页面，尚未提交诊断。请检查设备与参数后自行发起。'
        if (action.route_id === 'records' && deviceId) message = `已按设备 ${deviceId} 筛选诊断记录。`
      } else {
        if (action.mode === 'edit') {
          const target = await bounded(this.deps.getDevice(action.device_id!, signal), signal)
          check()
          if (target.id !== action.device_id) throw new Error('设备身份不匹配，未填写其他设备。')
        }
        check()
        this.deps.closeDock()
        await wait(() => !this.deps.current().dockOpen)
        await navigate(action.mode === 'create' ? '/admin/devices' : `/manage/devices/${encodeURIComponent(action.device_id!)}`)
        check()
        const ack = await this.deps.offerDraft({ actionId: action.action_id, mode: action.mode, deviceId: action.device_id, fields: action.fields }, signal)
        check()
        message = '已打开设备表单并预填你提供的字段，尚未保存。请检查后自行保存。' + (ack.missing.length ? `还需补充${ack.missing.join('、')}。` : '')
      }
      check()
      return { action_id: action.action_id, status: 'succeeded', message }
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const message = cancelled ? '本次操作已取消，未继续执行。' : error instanceof Error && !('isAxiosError' in error) ? error.message : '目标不存在、不可见或页面暂不可用，操作没有完成。'
      return { action_id: action.action_id, status: cancelled ? 'cancelled' : 'failed', message }
    }
  }
}

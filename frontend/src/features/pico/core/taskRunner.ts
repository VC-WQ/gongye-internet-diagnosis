import type { PicoActionResult, PicoContextSnapshot, PicoTaskResponse, PicoUiAction } from './types'
import type { PicoPageSnapshot } from './pageSnapshot'

interface TaskPage { context: PicoContextSnapshot; page_snapshot: PicoPageSnapshot }
export interface PicoTaskRunnerDependencies {
  start: (page: TaskPage) => Promise<PicoTaskResponse>
  resume: (response: PicoTaskResponse, page: TaskPage, observation?: PicoActionResult) => Promise<PicoTaskResponse>
  readPage: () => TaskPage
  valid: () => boolean
  execute: (action: PicoUiAction) => Promise<PicoActionResult>
  update: (response: PicoTaskResponse, results: PicoActionResult[]) => void
}

const stop = () => Object.assign(new Error('任务已取消或页面上下文已变化。'), { name: 'AbortError' })
const terminal = new Set(['completed', 'partial', 'failed', 'needs_input', 'cancelled', 'unverified'])

/** One real UI result and a fresh page snapshot per round trip. Never pre-execute a plan. */
export async function runPicoTask(id: string, deps: PicoTaskRunnerDependencies, signal: AbortSignal): Promise<PicoTaskResponse> {
  const results: PicoActionResult[] = []
  const started = Date.now()
  const check = () => { if (signal.aborted || !deps.valid()) throw stop(); if (Date.now() - started > 90000) throw new Error('任务已达到 90 秒时限，已停止后续步骤。') }
  const ready = async (): Promise<TaskPage> => {
    const deadline = Date.now() + 6500
    while (true) {
      check()
      const page = deps.readPage()
      if (page.page_snapshot.state !== 'loading') return page
      if (Date.now() >= deadline) throw new Error('页面数据尚未就绪，已停止后续操作。')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 40)
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(stop()) }
        signal.addEventListener('abort', abort, { once: true })
      })
    }
  }
  let page = await ready()
  let response = await deps.start(page)
  let lastStep = -1
  for (let round = 0; round < 10; round++) {
    check()
    if (response.task_id !== id || response.context_revision !== page.context.context_revision || !Number.isInteger(response.step) || response.step < lastStep || response.step > 8 || response.tool_calls > 12 || (!terminal.has(response.status) && !['running', 'awaiting_ui'].includes(response.status))) throw new Error('任务响应身份、上下文或执行预算不符合契约，已停止。')
    deps.update(response, [...results])
    if (terminal.has(response.status)) return response
    if (response.step <= lastStep) throw new Error('任务没有取得新的执行进度，已停止重复调用。')
    lastStep = response.step
    let observation: PicoActionResult | undefined
    if (response.status === 'awaiting_ui') {
      if (!response.ui_action) throw new Error('任务未提供有效的页面动作，已停止。')
      check()
      observation = await deps.execute(response.ui_action)
      results.push(observation)
      check()
      deps.update(response, [...results])
    }
    // Even failed UI steps return the observation to the controller, which may recover once.
    page = await ready()
    check()
    response = await deps.resume(response, page, observation)
  }
  throw new Error('任务已达到执行步数上限，进度已保留。')
}

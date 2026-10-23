import { useEffect, useRef, useState } from 'react'
import axios from 'axios'

export function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === 403) return '没有访问权限'
    if (status === 404) return '未找到所需记录'
    if (status === 401) return '登录已过期，请重新登录'
    if (status === 503) return '服务暂不可用，请稍后重试'
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (!error.response) return '连接失败，请检查网络或服务状态'
  }
  return '加载失败，请重试'
}

/** Requests are serialized and scoped to a key; old identities never render. */
export function useResource<T>(
  key: string,
  load: () => Promise<T>,
  interval = 0,
  enabled = true,
) {
  const loader = useRef(load)
  loader.current = load
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{
    key: string
    data?: T
    error?: string
    loading: boolean
  }>({ key, loading: enabled })
  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    setState((s) => ({
      key,
      data: s.key === key ? s.data : undefined,
      loading: true,
    }))
    const run = async () => {
      try {
        const data = await loader.current()
        if (active) setState({ key, data, loading: false })
      } catch (error) {
        if (active)
          setState((s) => ({
            key,
            data: s.key === key ? s.data : undefined,
            error: errorText(error),
            loading: false,
          }))
      } finally {
        if (active && interval > 0) timer = setTimeout(run, interval)
      }
    }
    void run()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [key, interval, enabled, version])
  return {
    ...(state.key === key
      ? state
      : { loading: enabled, data: undefined, error: undefined }),
    refresh: () => setVersion((v) => v + 1),
  }
}

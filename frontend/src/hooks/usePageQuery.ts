import { useSearchParams } from 'react-router-dom'
import { workspaceLink } from '../services/workspaceMode'

export function usePageQuery() {
  const [params, setParams] = useSearchParams()
  const update = (
    values: Record<string, string | undefined>,
    replace = false,
  ) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        Object.entries(values).forEach(([key, value]) =>
          value ? next.set(key, value) : next.delete(key),
        )
        return next
      },
      { replace },
    )
  }
  return { params, update }
}

/** 所有业务链接直接进入同一个工作空间；旧路由仅供外部兼容。 */
export const deviceLink = workspaceLink

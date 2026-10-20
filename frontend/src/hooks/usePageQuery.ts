import { useSearchParams } from 'react-router-dom'

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

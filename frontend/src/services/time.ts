export function formatTime(value?: string | number | null) {
  if (value == null) return '—'
  // Backend datetime.utcnow().isoformat() is UTC even when the suffix is absent.
  const normalized = typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) && !/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? `${value}Z` : value
  const date = new Date(typeof normalized === 'number' && normalized < 1e12 ? normalized * 1000 : normalized)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { hour12: false })
    : '—'
}

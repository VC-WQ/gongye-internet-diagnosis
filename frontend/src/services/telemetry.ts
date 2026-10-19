export const CHANNELS: Record<string, { name: string; unit: string }> = {
  vibration: { name: '振动', unit: 'g' },
  temperature: { name: '温度', unit: '℃' },
  current: { name: '电流', unit: 'A' },
  pressure: { name: '压力', unit: 'bar' },
  speed: { name: '转速', unit: 'rpm' },
  acoustic: { name: '声压', unit: 'dB' },
}
export type Sample = Record<string, unknown> & {
  device_id: string
  timestamp: number
}
export function parseSample(
  raw: unknown,
  device?: string,
  now = Date.now(),
): Sample | undefined {
  if (!raw || typeof raw !== 'object') return
  const data = raw as Record<string, unknown>
  if (data.device_id && data.device_id !== device && device) return
  const identity = typeof data.device_id === 'string' ? data.device_id : device
  const value = data.timestamp
  const parsed =
    typeof value === 'number'
      ? value < 1e12
        ? value * 1000
        : value
      : typeof value === 'string'
        ? Date.parse(value)
        : NaN
  if (!identity || !Number.isFinite(parsed) || parsed > now + 60000) return
  if (
    !Object.keys(CHANNELS).some(
      (key) => typeof data[key] === 'number' && Number.isFinite(data[key]),
    )
  )
    return
  return { ...data, device_id: identity, timestamp: parsed }
}

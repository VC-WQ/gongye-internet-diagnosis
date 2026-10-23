import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getDeviceWindow, getDevices } from './api'
import { useResource } from '../hooks/useResource'

import { parseSample, type Sample } from './telemetry'
export { CHANNELS, parseSample, type Sample } from './telemetry'

type RealtimeState = {
  status: 'connecting' | 'connected' | 'disconnected'
  latest: Record<string, Sample>
  now: number
}
const RealtimeContext = createContext<RealtimeState>({
  status: 'connecting',
  latest: {},
  now: Date.now(),
})
function useCatalogResource() {
  return useResource('device-catalog', getDevices, 10000)
}
const CatalogContext = createContext<ReturnType<
  typeof useCatalogResource
> | null>(null)
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const catalog = useCatalogResource()
  const [status, setStatus] = useState<RealtimeState['status']>('connecting')
  const [latest, setLatest] = useState<Record<string, Sample>>({})
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let stopped = false
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout>
    let flush: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let pending: Record<string, Sample> = {}
    const connect = () => {
      if (stopped) return
      setStatus('connecting')
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/mqtt-pipeline/ws`,
      )
      socket.onopen = () => {
        if (!stopped) {
          attempts = 0
          setStatus('connected')
        }
      }
      socket.onmessage = (event) => {
        try {
          const point = parseSample(JSON.parse(event.data))
          if (!point) return
          if (
            !pending[point.device_id] ||
            pending[point.device_id].timestamp <= point.timestamp
          )
            pending[point.device_id] = point
          if (!flush)
            flush = setTimeout(() => {
              const batch = pending
              pending = {}
              flush = undefined
              if (!stopped)
                setLatest((old) => {
                  const next = { ...old }
                  Object.values(batch).forEach((p) => {
                    if (
                      !next[p.device_id] ||
                      p.timestamp > next[p.device_id].timestamp
                    )
                      next[p.device_id] = p
                  })
                  return next
                })
            }, 200)
        } catch {
          /* Ignore non-sensor messages without fabricating values. */
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (stopped) return
        setStatus('disconnected')
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts++))
      }
    }
    connect()
    const clock = setInterval(() => setNow(Date.now()), 3000)
    return () => {
      stopped = true
      clearTimeout(retry)
      clearTimeout(flush)
      clearInterval(clock)
      socket?.close()
    }
  }, [])
  return (
    <CatalogContext.Provider value={catalog}>
      <RealtimeContext.Provider value={{ status, latest, now }}>
        {children}
      </RealtimeContext.Provider>
    </CatalogContext.Provider>
  )
}
export function useConnection() {
  return useContext(RealtimeContext)
}
export function useDeviceCatalog(_enabled = true) {
  const catalog = useContext(CatalogContext)
  if (!catalog) throw new Error('Device catalog requires RealtimeProvider')
  return catalog
}
export function useDeviceTelemetry(device?: string, enabled = true) {
  const { latest, status, now } = useConnection()
  const resource = useResource(
    `window:${device ?? ''}`,
    () => getDeviceWindow(device!),
    5000,
    Boolean(device) && enabled,
  )
  const [live, setLive] = useState<{ device?: string; points: Sample[] }>({
    points: [],
  })
  const current = device ? latest[device] : undefined
  const mountedAt = useRef(Date.now())
  useEffect(() => {
    if (!current || !enabled) return
    setLive((old) => ({
      device,
      points: [
        ...(old.device === device ? old.points : []).filter(
          (p) => p.timestamp !== current.timestamp,
        ),
        current,
      ].slice(-64),
    }))
  }, [current, device, enabled])
  const rest = Array.isArray(resource.data)
    ? resource.data
        .map((p: unknown) => parseSample(p, device))
        .filter((p): p is Sample => Boolean(p))
    : []
  const joined = new Map<number, Sample>()
  rest.forEach((p) => joined.set(p.timestamp, p))
  if (live.device === device)
    live.points.forEach((p) => joined.set(p.timestamp, p))
  const samples = Array.from(joined.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-64)
  const last = samples[samples.length - 1]
  const stale = Boolean(last && now - last.timestamp > 15000)
  const source =
    typeof last?.source === 'string'
      ? last.source
      : typeof last?.data_source === 'string'
        ? last.data_source
        : 'unknown'
  return {
    ...resource,
    samples,
    last,
    stale,
    source,
    status,
    waiting: !last && now - mountedAt.current < 5000,
  }
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { modeFromPath, workspaceLink, type WorkspaceMode } from './workspaceMode'

export type { WorkspaceMode } from './workspaceMode'

export interface WorkspaceFilters {
  q?: string
  status?: string
  page?: number
}

interface WorkspaceValue {
  pathname: string
  mode: WorkspaceMode
  selectedDeviceId?: string
  selectedEventId?: number
  activePanel?: string
  searchFilters: WorkspaceFilters
  contextRevision: number
  setDevice: (id?: string, opts?: { replace?: boolean }) => void
  setEvent: (id?: number, opts?: { replace?: boolean }) => void
  setPanel: (panel?: string, opts?: { replace?: boolean }) => void
  setFilters: (
    values: Record<string, string | undefined>,
    opts?: { replace?: boolean },
  ) => void
  navigateWorkspace: (
    path: string,
    opts?: { device?: string; event?: number; replace?: boolean },
  ) => void
  invalidate: () => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const mode = modeFromPath(location.pathname, location.search)
  const routeDevice = location.pathname.startsWith('/device/')
    ? decodeURIComponent(location.pathname.split('/')[2] ?? '')
    : undefined
  const queryDevice = params.get('device') ?? undefined
  const selectedDeviceId = routeDevice || queryDevice || undefined
  const selectedEventId = Number(params.get('event')) || undefined
  const activePanel = params.get('tab') ?? undefined
  const searchFilters = useMemo<WorkspaceFilters>(
    () => ({
      q: params.get('q') ?? undefined,
      status: params.get('status') ?? undefined,
      page: Number(params.get('page')) || undefined,
    }),
    [params],
  )

  const update = useCallback(
    (
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
    },
    [setParams],
  )

  const setDevice = useCallback(
    (id?: string, opts?: { replace?: boolean }) =>
      update({ device: id, event: undefined }, opts?.replace ?? false),
    [update],
  )
  const setEvent = useCallback(
    (id?: number, opts?: { replace?: boolean }) =>
      update(
        { event: id == null ? undefined : String(id) },
        opts?.replace ?? false,
      ),
    [update],
  )
  // 面板切换用 replace，避免一次后退只回到上一个 Tab
  const setPanel = useCallback(
    (panel?: string, opts?: { replace?: boolean }) =>
      update({ tab: panel }, opts?.replace ?? true),
    [update],
  )
  const setFilters = useCallback(
    (
      values: Record<string, string | undefined>,
      opts?: { replace?: boolean },
    ) => update(values, opts?.replace ?? true),
    [update],
  )
  const navigateWorkspace = useCallback(
    (
      path: string,
      opts?: { device?: string; event?: number; replace?: boolean },
    ) => {
      navigate(workspaceLink(path, opts?.device, opts?.event), {
        replace: opts?.replace ?? false,
      })
    },
    [navigate],
  )

  // 上下文指纹变化或业务写入后递增，供 Pico/列表判断“旧响应是否已过期”
  const fingerprint = `${location.pathname}|${mode}|${selectedDeviceId ?? ''}|${
    selectedEventId ?? ''
  }|${activePanel ?? ''}|${params.get('q') ?? ''}|${
    params.get('status') ?? ''
  }|${params.get('page') ?? ''}`
  const [revision, setRevision] = useState(0)
  const lastFingerprint = useRef(fingerprint)
  useEffect(() => {
    if (lastFingerprint.current !== fingerprint) {
      lastFingerprint.current = fingerprint
      setRevision((value) => value + 1)
    }
  }, [fingerprint])
  const invalidate = useCallback(() => setRevision((value) => value + 1), [])

  const value = useMemo<WorkspaceValue>(
    () => ({
      pathname: location.pathname,
      mode,
      selectedDeviceId,
      selectedEventId,
      activePanel,
      searchFilters,
      contextRevision: revision,
      setDevice,
      setEvent,
      setPanel,
      setFilters,
      navigateWorkspace,
      invalidate,
    }),
    [
      location.pathname,
      mode,
      selectedDeviceId,
      selectedEventId,
      activePanel,
      searchFilters,
      revision,
      setDevice,
      setEvent,
      setPanel,
      setFilters,
      navigateWorkspace,
      invalidate,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}

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
import {
  areaFromPath,
  deviceSelectionPatch,
  factoryPath,
  normalizeDetail,
  normalizePanel,
  normalizeStatus,
  safeDecode,
  statusFilterPatch,
  workspaceLink,
  type Area,
  type DetailTab,
  type FactoryPanel,
  type StatusFilter,
} from './workspaceMode'

export type { Area, DetailTab, FactoryPanel, StatusFilter } from './workspaceMode'

export interface WorkspaceFilters {
  q?: string
  page?: number
}

interface WorkspaceValue {
  pathname: string
  area: Area
  selectedDeviceId?: string
  selectedEventId?: number
  panel: FactoryPanel
  detailTab: DetailTab
  statusFilter: StatusFilter
  channel?: string
  searchFilters: WorkspaceFilters
  contextRevision: number
  setDevice: (id?: string, opts?: { replace?: boolean }) => void
  setEvent: (id?: number, opts?: { replace?: boolean }) => void
  setPanel: (panel: FactoryPanel, opts?: { replace?: boolean }) => void
  closePanel: () => void
  setDetail: (tab: DetailTab) => void
  setStatusFilter: (status: StatusFilter) => void
  setChannel: (channel?: string) => void
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

  const area = areaFromPath(location.pathname)
  const pathDevice = location.pathname.startsWith('/manage/devices/')
    ? safeDecode(location.pathname.split('/')[3] ?? '') : undefined
  const pathEvent = location.pathname.startsWith('/manage/records/')
    ? Number(location.pathname.split('/')[3]) : undefined
  const selectedDeviceId = pathDevice ?? params.get('device') ?? undefined
  const eventValue = pathEvent ?? Number(params.get('event'))
  const selectedEventId = Number.isSafeInteger(eventValue) && Number(eventValue) > 0 ? eventValue : undefined
  const panel = normalizePanel(params.get('panel'))
  const detailTab = normalizeDetail(params.get('detail'))
  const statusFilter = normalizeStatus(params.get('status'))
  const channel = params.get('channel') ?? undefined
  const searchFilters = useMemo<WorkspaceFilters>(
    () => ({
      q: params.get('q') ?? undefined,
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
      update(
        deviceSelectionPatch(id),
        opts?.replace ?? true,
      ),
    [update],
  )
  const setEvent = useCallback(
    (id?: number, opts?: { replace?: boolean }) =>
      update(
        { event: id == null ? undefined : String(id) },
        opts?.replace ?? true,
      ),
    [update],
  )
  // 打开面板写入历史（后退可关闭）；关闭用 replace，避免留下无意义来回记录。
  const setPanel = useCallback(
    (next: FactoryPanel, opts?: { replace?: boolean }) =>
      update(
        { panel: next === 'none' ? undefined : next },
        opts?.replace ?? (next === 'none'),
      ),
    [update],
  )
  const closePanel = useCallback(
    () => update({ panel: undefined, detail: undefined, tab: undefined }, true),
    [update],
  )
  const setDetail = useCallback(
    (tab: DetailTab) => update({ detail: tab === 'realtime' ? undefined : tab }, true),
    [update],
  )
  const setStatusFilter = useCallback(
    (status: StatusFilter) =>
      update(
        statusFilterPatch(status),
        true,
      ),
    [update],
  )
  const setChannel = useCallback(
    (next?: string) => update({ channel: next }, true),
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
  const fingerprint = `${location.pathname}|${area}|${selectedDeviceId ?? ''}|${
    selectedEventId ?? ''
  }|${panel}|${detailTab}|${statusFilter}|${channel ?? ''}|${params.get('q') ?? ''}|${
    params.get('page') ?? ''
  }`
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
      area,
      selectedDeviceId,
      selectedEventId,
      panel,
      detailTab,
      statusFilter,
      channel,
      searchFilters,
      contextRevision: revision,
      setDevice,
      setEvent,
      setPanel,
      closePanel,
      setDetail,
      setStatusFilter,
      setChannel,
      setFilters,
      navigateWorkspace,
      invalidate,
    }),
    [
      location.pathname,
      area,
      selectedDeviceId,
      selectedEventId,
      panel,
      detailTab,
      statusFilter,
      channel,
      searchFilters,
      revision,
      setDevice,
      setEvent,
      setPanel,
      closePanel,
      setDetail,
      setStatusFilter,
      setChannel,
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

/** 供不依赖 URL 的纯展示组件复用当前工厂身份。 */
export function useFactorySelection() {
  const workspace = useWorkspace()
  return {
    deviceId: workspace.selectedDeviceId,
    eventId: workspace.selectedEventId,
    selectDevice: workspace.setDevice,
    selectEvent: workspace.setEvent,
  }
}

/** 生成带当前设备/事件身份的工厂地址。 */
export function useFactoryLink() {
  const workspace = useWorkspace()
  return useCallback(
    (options: Parameters<typeof factoryPath>[0]) =>
      factoryPath({
        device: workspace.selectedDeviceId,
        event: workspace.selectedEventId,
        ...options,
      }),
    [workspace.selectedDeviceId, workspace.selectedEventId],
  )
}

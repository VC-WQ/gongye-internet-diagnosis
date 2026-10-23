import axios from 'axios'

// Axios 实例：统一请求封装
// 开发环境由 vite 代理将 /api 转发到后端 http://localhost:8000
const api = axios.create({
  baseURL: '/api/v1',
  timeout: 20000,
})

// 请求拦截器：附加认证 token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 响应拦截器：401 跳转登录
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      const next = window.location.pathname + window.location.search
      sessionStorage.setItem('auth:returnTo', next)
      window.location.assign('/login')
    }
    return Promise.reject(error)
  },
)

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------
export interface Device {
  id: string
  name: string
  device_type: string // pump / motor / compressor
  status: string // healthy / degraded / fault / offline
  health_score: number
  edge_anomaly_score: number
  threshold_vibration: number | null
  threshold_temp: number | null
  last_updated: number | null
}

export interface DiagnosisReport {
  summary?: string
  physical_evidence?: string
  signal_evidence?: string
  knowledge_basis?: string
  diagnosis?: { fault_type?: string; confidence?: number; reasoning?: string }
  impact?: string
  recommendation?: string
  follow_up_questions?: string[]
  [key: string]: unknown
}

export interface AgentResult {
  agent_role: string
  agent_name: string
  conclusion: string
  fault_type: string
  confidence: number
  evidence: string
  details: Record<string, unknown>
}

export interface ConsultResult {
  device_id: string
  fault_type: string
  fault_label: string
  confidence: number
  health_score: number
  health_level: string
  level_label: string
  available_channels: string[]
  agent_results: AgentResult[]
  recommendation: string
  report: DiagnosisReport
  conflicts: unknown[]
  conflict_detected: boolean
}

export interface EventSummary {
  id: number
  device_id: string
  event_type: string
  status_state: string | null
  severity: string
  fault_type: string | null
  confidence: number | null
  health_score: number | null
  report: DiagnosisReport | null
  timestamp: string | null
  agent_diagnosis?: ConsultResult
}

// ---------------------------------------------------------------------------
// 设备目录
// ---------------------------------------------------------------------------
export const getDevices = () => api.get<Device[]>('/devices').then((r) => r.data)

export const getDevice = (id: string, signal?: AbortSignal) =>
  api.get<Device>(`/devices/${id}`, { signal }).then((r) => r.data)

export const getDeviceWindow = (deviceId: string) =>
  api.get(`/mqtt-pipeline/window/${deviceId}`).then((r) => r.data)

export const getHealthHistory = (deviceId: string) =>
  api.get(`/devices/${deviceId}/health-history`).then((r) => r.data)

export const injectFault = (deviceId: string, mode: string) =>
  api.post(`/devices/${deviceId}/inject`, { mode }).then((r) => r.data)

// ---------------------------------------------------------------------------
// 事件（指令闭环）
// ---------------------------------------------------------------------------
export const createEvent = (
  deviceId: string,
  window: unknown[],
  operator = 'system',
  vision?: { available: boolean; damage_type: string | null; confidence: number; count: number },
) =>
  api
    .post('/command-loop/events', { device_id: deviceId, window, operator, vision })
    .then((r) => r.data)

export const listEvents = (params?: { device_id?: string; limit?: number; offset?: number }) =>
  api.get<EventSummary[]>('/command-loop/events', { params }).then((r) => r.data)

export const getEvent = (id: number, signal?: AbortSignal) =>
  api.get<EventSummary>(`/command-loop/events/${id}`, { signal }).then((r) => r.data)

export const confirmEvent = (id: number, operator: string) =>
  api.post(`/command-loop/events/${id}/confirm`, { operator }).then((r) => r.data)

export const rejectEvent = (id: number, operator: string, reason: string) =>
  api.post(`/command-loop/events/${id}/reject`, { operator, reason }).then((r) => r.data)

/** 人工修改诊断建议（改写报告并留痕，状态机状态不变） */
export const reviseEvent = (
  id: number,
  operator: string,
  payload: { recommendation?: string; fault_label?: string; note?: string },
) =>
  api
    .post(`/command-loop/events/${id}/revise`, { operator, ...payload })
    .then((r) => r.data)

export const executeEvent = (id: number, operator: string, command?: string) =>
  api.post(`/command-loop/events/${id}/execute`, { operator, command }).then((r) => r.data)

export interface ObservationResult {
  event_id: number
  status_state: string
  feedback_result: {
    verdict: 'recovered' | 'extend' | 'relapsed'
    deviation_pct: number
    diagnosis_confirmed: boolean
    trigger_rediagnosis: boolean
    actual_curve: number[]
    predicted_curve: number[]
  }
}

export const observeEvent = (
  id: number,
  actualCurve: number[],
  operator: string,
) =>
  api
    .post<ObservationResult>(`/command-loop/events/${id}/observe`, {
      actual_curve: actualCurve,
      operator,
    })
    .then((r) => r.data)

export const getEventTimeline = (id: number) =>
  api.get(`/command-loop/events/${id}/timeline`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 多智能体会诊
// ---------------------------------------------------------------------------
export const consult = (deviceId: string, window: unknown[]) =>
  api.post<ConsultResult>(`/multi-agent/consult?device_id=${encodeURIComponent(deviceId)}`, { window }).then((r) => r.data)

export const getAgents = () => api.get('/multi-agent/agents').then((r) => r.data)

// ---------------------------------------------------------------------------
// 事件时间线（可视化）
// ---------------------------------------------------------------------------
export const getTimelineEvent = (
  eventId: number | string,
  params?: { max_points?: number; simulate_latent?: boolean },
) => api.get(`/timeline/event/${eventId}`, { params }).then((r) => r.data)

export const getTimelineDevice = (deviceId: string) =>
  api.get(`/timeline/device/${deviceId}`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------
export const getFlashReport = (body: unknown) =>
  api.post('/reports/flash', body).then((r) => r.data)

export const getEventReport = (eventId: number) =>
  api.post(`/reports/event/${eventId}`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 系统自评 / 阈值
// ---------------------------------------------------------------------------
export const getSelfEvalMetrics = (days = 30) =>
  api.get('/self-eval/metrics', { params: { days } }).then((r) => r.data)

// 双闭环自进化统计（内闭环：事件级自动再诊断；外闭环：阈值建议采纳率）
export const getSelfEvalLoops = (days = 30) =>
  api.get('/self-eval/loops', { params: { days } }).then((r) => r.data)

export const getThresholdEffects = () => api.get('/threshold/effects').then((r) => r.data)

export const listThresholdSuggestions = (params?: { device_id?: string; status?: string }) =>
  api.get('/threshold/suggestions', { params }).then((r) => r.data)

export const acceptThresholdSuggestion = (id: number, operator: string) =>
  api.post(`/threshold/suggestions/${id}/accept`, { operator }).then((r) => r.data)

export const rejectThresholdSuggestion = (id: number, operator: string) =>
  api.post(`/threshold/suggestions/${id}/reject`, { operator }).then((r) => r.data)

export const getThresholdHistory = (deviceId: string) =>
  api.get(`/threshold/history/${deviceId}`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 数字孪生
// ---------------------------------------------------------------------------
export const getDigitalTwinSnapshot = (deviceId: string) =>
  api.get(`/digital-twin/${deviceId}/snapshot`).then((r) => r.data)

export const getAcousticSpectrum = (deviceId: string) =>
  api.get(`/acoustic/spectrum/${deviceId}`).then((r) => r.data)

export const getAcousticFusion = (deviceId: string) =>
  api.get(`/acoustic/fuse-device/${deviceId}`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 认证
// ---------------------------------------------------------------------------
export interface AuthUser {
  id: number
  username: string
  role: string
  is_active: boolean
}

export const login = (username: string, password: string) =>
  api.post<{ token: string; user: AuthUser }>('/auth/login', { username, password }).then((r) => r.data)

export const register = (username: string, password: string) =>
  api.post<{ token: string; user: AuthUser }>('/auth/register', { username, password }).then((r) => r.data)

export const getMe = (signal?: AbortSignal) => api.get<AuthUser>('/auth/me', { signal }).then((r) => r.data)

// ---------------------------------------------------------------------------
// 用户管理（admin）
// ---------------------------------------------------------------------------
export const listUsers = () => api.get<AuthUser[]>('/users').then((r) => r.data)

export const createUser = (data: { username: string; password: string; role: string }) =>
  api.post('/users', data).then((r) => r.data)

export const updateUser = (id: number, data: { role?: string; is_active?: boolean; password?: string }) =>
  api.put(`/users/${id}`, data).then((r) => r.data)

export const deleteUser = (id: number) => api.delete(`/users/${id}`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 设备管理（admin）
// ---------------------------------------------------------------------------
export const createDevice = (data: { id: string; name: string; device_type: string; health_score?: number; status?: string }) =>
  api.post('/devices', data).then((r) => r.data)

export const updateDevice = (id: string, data: Partial<Device>) =>
  api.put(`/devices/${id}`, data).then((r) => r.data)

export const deleteDevice = (id: string) => api.delete(`/devices/${id}`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 诊断记录管理（admin）
// ---------------------------------------------------------------------------
export const listRecords = (params?: { device_id?: string; offset?: number; limit?: number }) =>
  api.get<{ total: number; items: unknown[] }>('/records', { params }).then((r) => r.data)

export const getRecord = (id: number) => api.get(`/records/${id}`).then((r) => r.data)

export const deleteRecord = (id: number) => api.delete(`/records/${id}`).then((r) => r.data)

// ---------------------------------------------------------------------------
// 可视化数据（预计算分析结果，供大屏 ECharts 绘制）
// ---------------------------------------------------------------------------
export const getXjtuRul = () => api.get('/viz/xjtu-rul').then((r) => r.data)

export const getSteamAnalysis = () => api.get('/viz/steam').then((r) => r.data)

export const getClassification = () => api.get('/viz/classification').then((r) => r.data)

export const getRulMl = () => api.get('/viz/rul-ml').then((r) => r.data)

export const getSteamMl = () => api.get('/viz/steam-ml').then((r) => r.data)

export const getPumpPhm = () => api.get('/viz/pump-phm').then((r) => r.data)

export const getCwruSignal = () => api.get('/viz/cwru-signal').then((r) => r.data)

export const getSmartFactory = () => api.get('/viz/smartfactory').then((r) => r.data)

export const getDatasetRegistry = () => api.get('/viz/dataset-registry').then((r) => r.data)

// 算法创新实验验证（创新点一 / 二 / 四）
export const getFpCnnCompare = () => api.get('/viz/fp-cnn-compare').then((r) => r.data)

export const getRulSdePf = () => api.get('/viz/rul-sde-pf').then((r) => r.data)

export const getDomainAdapt = () => api.get('/viz/domain-adapt').then((r) => r.data)

// ---------------------------------------------------------------------------
// 视觉检测智能体
// ---------------------------------------------------------------------------
export const getVisionModels = () => api.get('/vision/models').then((r) => r.data)

export const getVisionSamples = (model = 'yolov8s') =>
  api.get('/vision/samples', { params: { model } }).then((r) => r.data)

export const getVisionComparison = () => api.get('/vision/comparison').then((r) => r.data)

export const detectVision = (file: File, model = 'yolov8s', conf = 0.25) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('model', model)
  fd.append('conf', String(conf))
  return api.post('/vision/detect', fd).then((r) => r.data)
}

export default api

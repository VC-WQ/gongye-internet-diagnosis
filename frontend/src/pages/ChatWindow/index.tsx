import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Space,
  Upload,
  message,
} from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { speakChinese, stopChineseSpeech } from '../../services/speech'
import DiagnosisSummary from '../../components/DiagnosisSummary'
import { LoadState, PageHeading, SourceTag } from '../../components/BusinessUI'
import {
  createEvent,
  detectVision,
  getEvent,
  type EventSummary,
} from '../../services/api'
import { useDeviceCatalog, useDeviceTelemetry } from '../../services/realtime'
import { errorText, useResource } from '../../hooks/useResource'
import { deviceLink, usePageQuery } from '../../hooks/usePageQuery'

interface VisionEvidence {
  available: boolean
  damage_type: string | null
  confidence: number
  count: number
}
const DAMAGE_LABELS: Record<string, string> = {
  crazing: '裂纹',
  inclusion: '夹杂',
  patches: '斑块',
  pitted_surface: '点蚀',
  'rolled-in_scale': '氧化铁皮',
  scratches: '划痕',
}
export default function ChatWindow() {
  const navigate = useNavigate()
  const location = useLocation()
  const { params, update } = usePageQuery()
  const catalog = useDeviceCatalog()
  const deviceId = params.get('device') ?? undefined
  const eventId = Number(params.get('event')) || undefined
  const chosen = catalog.data?.find((d) => d.id === deviceId)
  const telemetry = useDeviceTelemetry(chosen?.id)
  const event = useResource(
    `diagnosis-event:${eventId ?? ''}`,
    () => getEvent(eventId!),
    0,
    Boolean(eventId),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [vision, setVision] = useState<VisionEvidence>()
  const [visionLoading, setVisionLoading] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const generation = useRef(0)
  // 同步锁：同一事件循环内的双击也必须只发一次请求
  const creating = useRef(false)
  const currentDevice = useRef(deviceId)
  currentDevice.current = deviceId
  const currentLocation = useRef(location.key)
  currentLocation.current = location.key
  useEffect(() => {
    generation.current += 1
    setVision(undefined)
    setLoading(false)
    setVisionLoading(false)
    setError('')
    setSpeaking(false)
    stopChineseSpeech()
    return () => {
      generation.current += 1
      stopChineseSpeech()
    }
  }, [deviceId, location.key])
  useEffect(() => {
    if (event.data && event.data.device_id !== deviceId)
      update({ device: event.data.device_id }, true)
  }, [event.data?.id, event.data?.device_id, deviceId])
  const validEvent = event.data?.device_id === deviceId ? event.data : undefined
  // 未闭环事件：禁止在同一设备上重复创建诊断事件
  const activeEvent =
    validEvent &&
    ['consulting', 'pending', 'handling', 'observing'].includes(
      validEvent.status_state ?? '',
    )
  const start = async () => {
    if (!chosen || loading || creating.current) return
    if (!telemetry.samples.length || telemetry.stale || telemetry.error) {
      setError('暂无有效采样，请等待数据源恢复后重试')
      return
    }
    creating.current = true
    const request = ++generation.current
    const originKey = location.key
    const device = chosen.id
    setLoading(true)
    setError('')
    stopChineseSpeech()
    setSpeaking(false)
    try {
      const result: EventSummary = await createEvent(
        device,
        telemetry.samples.map((p) => ({ ...p, timestamp: p.timestamp / 1000 })),
        JSON.parse(localStorage.getItem('user') ?? '{}').username ?? 'operator',
        vision,
      )
      if (
        generation.current !== request ||
        currentDevice.current !== device ||
        currentLocation.current !== originKey
      )
        return
      if (!result.id || result.device_id !== device)
        throw new Error('诊断结果身份不一致')
      update({ device, event: String(result.id) })
    } catch (e) {
      if (generation.current === request)
        setError(
          e instanceof Error && e.message === '诊断结果身份不一致'
            ? e.message
            : errorText(e),
        )
    } finally {
      creating.current = false
      if (generation.current === request) setLoading(false)
    }
  }
  const upload = async (file: File) => {
    const request = generation.current
    setVisionLoading(true)
    try {
      const result = await detectVision(file)
      if (generation.current !== request) return false
      const top = result?.detections?.[0]
      setVision({
        available: true,
        damage_type: top?.class ?? null,
        confidence: top?.confidence ?? 0,
        count: result?.count ?? result?.detections?.length ?? 0,
      })
      message.success('视觉检测完成')
    } catch (e) {
      if (generation.current === request) {
        setVision(undefined)
        setError(errorText(e))
      }
    } finally {
      if (generation.current === request) setVisionLoading(false)
    }
    return false
  }
  const speak = () => {
    if (!validEvent) return
    const text = `设备 ${deviceId}。${validEvent.report?.summary ?? ''}。维护建议：${validEvent.report?.recommendation ?? '暂无'}`
    setSpeaking(speakChinese(text, () => setSpeaking(false)))
  }
  return (
    <>
      <PageHeading
        title="智能诊断"
        meta={
          <>
            <SourceTag source={telemetry.source} />
            <span>
              {telemetry.stale
                ? '采样已过期'
                : telemetry.last
                  ? `${telemetry.samples.length} 点有效采样`
                  : '暂无有效采样'}
            </span>
          </>
        }
        actions={
          <Button
            disabled={!validEvent}
            onClick={
              speaking
                ? () => {
                    stopChineseSpeech()
                    setSpeaking(false)
                  }
                : speak
            }
          >
            {speaking ? '停止播报' : '播报结论'}
          </Button>
        }
      />
      <div className="diagnosis-layout">
        <div>
          <section className="surface">
            <div className="section-header">
              <h2>诊断对象</h2>
              {chosen && (
                <Button
                  type="link"
                  size="small"
                  onClick={() =>
                    navigate(deviceLink('/device/' + encodeURIComponent(chosen.id)), {
                      state: { returnTo: location.pathname + location.search },
                    })
                  }
                >
                  设备详情 ›
                </Button>
              )}
            </div>
            <LoadState error={catalog.error} onRetry={catalog.refresh}>
              <Space wrap>
                {chosen ? (
                  <strong>{chosen.name} <small>{chosen.id}</small></strong>
                ) : (
                  <Button onClick={() => navigate(deviceLink('/devices'))}>从设备浏览选择诊断对象</Button>
                )}
                {activeEvent ? (
                  <Button
                    type="primary"
                    onClick={() =>
                      navigate(
                        deviceLink('/events', deviceId, validEvent?.id),
                        {
                          state: {
                            returnTo: location.pathname + location.search,
                          },
                        },
                      )
                    }
                  >
                    当前事件待处置 · 前往事件处置
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    onClick={start}
                    loading={loading}
                    disabled={
                      !chosen ||
                      visionLoading ||
                      !telemetry.samples.length ||
                      telemetry.stale ||
                      Boolean(telemetry.error)
                    }
                  >
                    发起诊断
                  </Button>
                )}
              </Space>
            </LoadState>
            <Collapse
              ghost
              style={{ marginTop: 16 }}
              items={[
                {
                  key: 'vision',
                  label: '视觉证据（可选）',
                  children: (
                    <Space wrap>
                      <Upload
                        accept="image/*"
                        beforeUpload={upload}
                        showUploadList={false}
                        disabled={loading || visionLoading}
                      >
                        <Button loading={visionLoading}>上传部件图像</Button>
                      </Upload>
                      {vision && (
                        <>
                          <span style={{ fontSize: 12 }}>
                            {vision.damage_type
                              ? `${DAMAGE_LABELS[vision.damage_type] ?? vision.damage_type} · ${vision.count} 处`
                              : '未检出表面缺陷'}
                          </span>
                          <Button
                            type="text"
                            onClick={() => setVision(undefined)}
                          >
                            清除
                          </Button>
                        </>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
            {(error || telemetry.error) && (
              <Alert
                style={{ marginTop: 16 }}
                type="error"
                showIcon
                message={error || telemetry.error}
              />
            )}
            {!telemetry.samples.length && !telemetry.loading && (
              <div className="page-meta">暂无有效采样，诊断暂不可用</div>
            )}
          </section>
          <section className="surface">
            <LoadState
              loading={
                loading || (Boolean(eventId) && event.loading && !validEvent)
              }
              error={eventId ? event.error : undefined}
              onRetry={event.refresh}
              empty={!validEvent}
              emptyText="选择设备并发起诊断"
            >
              {validEvent && (
                <>
                  <DiagnosisSummary event={validEvent} />
                  <div className="page-meta">
                    确认、修改、拒绝与下发指令请在「事件处置」中完成；本页只负责创建诊断与查看结论。
                  </div>
                  <div className="actions-row">
                    <Button
                      onClick={() =>
                        navigate(
                          deviceLink(
                            '/events',
                            validEvent.device_id,
                            validEvent.id,
                          ),
                          {
                            state: {
                              returnTo: location.pathname + location.search,
                            },
                          },
                        )
                      }
                    >
                      事件与时间线
                    </Button>
                    <Button
                      onClick={() =>
                        navigate(
                          deviceLink(
                            '/reports',
                            validEvent.device_id,
                            validEvent.id,
                          ),
                          {
                            state: {
                              returnTo: location.pathname + location.search,
                            },
                          },
                        )
                      }
                    >
                      阅读报告
                    </Button>
                  </div>
                </>
              )}
            </LoadState>
          </section>
        </div>
      </div>
    </>
  )
}

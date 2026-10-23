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
import { speakChinese, stopChineseSpeech } from '../../../services/speech'
import DiagnosisSummary from '../../../components/DiagnosisSummary'
import { LoadState, SourceTag } from '../../../components/BusinessUI'
import {
  createEvent,
  detectVision,
  type Device,
  type EventSummary,
} from '../../../services/api'
import type { useDeviceTelemetry } from '../../../services/realtime'
import { errorText } from '../../../hooks/useResource'
import { useWorkspace } from '../../../services/workspace'
import { useSpatialNavigate } from '../../../hooks/useSpatialNavigate'
import { toolPath } from '../../../services/workspaceMode'

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

const ACTIVE_STATES = ['consulting', 'pending', 'handling', 'observing']

export default function DiagnosisPanel({
  device,
  telemetry,
  event,
  deviceActiveEvent,
  eventLoading,
  eventError,
  onRefreshEvent,
  onChanged,
}: {
  device?: Device
  telemetry: ReturnType<typeof useDeviceTelemetry>
  event?: EventSummary
  deviceActiveEvent?: EventSummary
  eventLoading: boolean
  eventError?: string
  onRefreshEvent: () => void
  onChanged: () => void
}) {
  const workspace = useWorkspace()
  const navigate = useSpatialNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [vision, setVision] = useState<VisionEvidence>()
  const [visionLoading, setVisionLoading] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const generation = useRef(0)
  const creating = useRef(new Map<string, number>())
  const mounted = useRef(false)
  const currentDevice = useRef(device?.id)
  currentDevice.current = device?.id
  const validEvent = event && event.device_id === device?.id ? event : undefined
  const activeEvent =
    validEvent && ACTIVE_STATES.includes(validEvent.status_state ?? '')
      ? validEvent
      : deviceActiveEvent

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    generation.current += 1
    setVision(undefined)
    setLoading(Boolean(device?.id && creating.current.has(device.id)))
    setVisionLoading(false)
    setError('')
    setSpeaking(false)
    stopChineseSpeech()
    return () => {
      generation.current += 1
      stopChineseSpeech()
    }
  }, [device?.id])

  const start = async () => {
    if (!device || loading || creating.current.has(device.id)) return
    if (!telemetry.samples.length || telemetry.stale || telemetry.error) {
      setError('暂无有效采样，请等待数据源恢复后重试')
      return
    }
    const request = ++generation.current
    const requestDevice = device.id
    creating.current.set(requestDevice, request)
    setLoading(true)
    setError('')
    stopChineseSpeech()
    setSpeaking(false)
    try {
      const result: EventSummary = await createEvent(
        requestDevice,
        telemetry.samples.map((point) => ({
          ...point,
          timestamp: point.timestamp / 1000,
        })),
        JSON.parse(localStorage.getItem('user') ?? '{}').username ?? 'operator',
        vision,
      )
      if (generation.current !== request || currentDevice.current !== requestDevice)
        return
      if (!result.id || result.device_id !== requestDevice)
        throw new Error('诊断结果身份不一致')
      workspace.setEvent(result.id, { replace: true })
      workspace.invalidate()
      onChanged()
    } catch (caught) {
      if (generation.current === request)
        setError(
          caught instanceof Error && caught.message === '诊断结果身份不一致'
            ? caught.message
            : errorText(caught),
        )
    } finally {
      if (creating.current.get(requestDevice) === request) creating.current.delete(requestDevice)
      if (mounted.current && currentDevice.current === requestDevice) {
        setLoading(false)
        if (generation.current !== request) onChanged()
      }
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
    } catch (caught) {
      if (generation.current === request) {
        setVision(undefined)
        setError(errorText(caught))
      }
    } finally {
      if (generation.current === request) setVisionLoading(false)
    }
    return false
  }

  const speak = () => {
    if (!validEvent) return
    const text = `设备 ${device?.id}。${validEvent.report?.summary ?? ''}。维护建议：${validEvent.report?.recommendation ?? '暂无'}`
    setSpeaking(speakChinese(text, () => setSpeaking(false)))
  }

  return (
    <div className="diagnosis-panel">
      {!device ? (
        <Empty description="选择一台设备" />
      ) : (
        <>
          <div className="diagnosis-panel__object">
            <div>
              <h3>{device.name}</h3>
              <p>
                {device.id} ·{' '}
                {telemetry.samples.length
                  ? `${telemetry.samples.length} 点有效采样`
                  : '暂无有效采样'}
                {telemetry.stale ? ' · 数据已过期' : ''}
                {' · '}<SourceTag source={telemetry.source} />
              </p>
            </div>
            <Button
              type="text"
              disabled={!validEvent}
              onClick={() => {
                if (speaking) {
                  stopChineseSpeech()
                  setSpeaking(false)
                } else speak()
              }}
            >
              {speaking ? '停止播报' : '播报结论'}
            </Button>
          </div>
          <Space wrap className="diagnosis-panel__actions">
            {activeEvent ? (
              <>
                <Alert
                  type="info"
                  showIcon
                  message={`事件 #${activeEvent.id} 待处置`}
                  description="该设备已有未闭环事件，请先完成处置或观察，避免重复创建诊断。"
                />
                <Button
                  type="primary"
                  onClick={() =>
                    navigate(toolPath('events', device?.id, activeEvent.id))
                  }
                >
                  前往事件处置
                </Button>
              </>
            ) : (
              <Button
                type="primary"
                onClick={start}
                loading={loading}
                disabled={
                  !device ||
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
          {!telemetry.samples.length && !telemetry.loading && (
            <p className="factory-note">暂无有效采样，诊断暂不可用</p>
          )}
          <Collapse
            ghost
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
                        <span className="factory-note">
                          {vision.damage_type
                            ? `${DAMAGE_LABELS[vision.damage_type] ?? vision.damage_type} · ${vision.count} 处`
                            : '未检出表面缺陷'}
                        </span>
                        <Button type="text" onClick={() => setVision(undefined)}>
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
              type="error"
              showIcon
              message={error || telemetry.error}
              action={
                telemetry.error ? (
                  <Button size="small" onClick={telemetry.refresh}>
                    重试
                  </Button>
                ) : undefined
              }
            />
          )}
          <div className="diagnosis-panel__result">
            <LoadState
              loading={eventLoading && !validEvent}
              error={eventError}
              onRetry={onRefreshEvent}
              empty={!validEvent}
              emptyText={
                activeEvent ? '请先完成当前事件处置' : '发起诊断后在此查看结论'
              }
            >
              {validEvent && (
                <>
                  <DiagnosisSummary event={validEvent} />
                  <div className="actions-row">
                    <Button
                      onClick={() =>
                        navigate(toolPath('events', device?.id, validEvent.id))
                      }
                    >
                      事件与时间线
                    </Button>
                    <Button
                      onClick={() =>
                        navigate(toolPath('events', device?.id, validEvent.id, 'report'))
                      }
                    >
                      阅读报告
                    </Button>
                  </div>
                </>
              )}
            </LoadState>
          </div>
        </>
      )}
    </div>
  )
}

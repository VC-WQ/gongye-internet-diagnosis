import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Modal,
  Radio,
  Select,
  Space,
  message,
} from 'antd'
import { injectFault, type Device } from '../../services/api'
import { useDeviceCatalog } from '../../services/realtime'
import { usePageQuery } from '../../hooks/usePageQuery'
import { errorText } from '../../hooks/useResource'
import { LoadState, SourceTag, StatusTag } from '../../components/BusinessUI'
export default function FaultInjection() {
  const catalog = useDeviceCatalog()
  const { params, update } = usePageQuery()
  const deviceId = params.get('device') ?? catalog.data?.[0]?.id
  const [mode, setMode] = useState('degradation')
  const [result, setResult] = useState<Device>()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current += 1
    setResult(undefined)
    setOpen(false)
    return () => {
      generation.current += 1
    }
  }, [deviceId])
  const inject = async () => {
    if (!deviceId) return
    const request = generation.current
    setLoading(true)
    try {
      const data = await injectFault(deviceId, mode)
      if (request === generation.current) {
        setResult(data)
        catalog.refresh()
        setOpen(false)
        message.success('仿真场景已更新')
      }
    } catch (e) {
      if (request === generation.current) message.error(errorText(e))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }
  return (
    <section className="surface">
      <div className="section-header">
        <h2>仿真测试</h2>
        <SourceTag source="simulation" />
      </div>
      <Alert
        showIcon
        type="warning"
        message="修改设备目录中的仿真健康状态，不代表实际采样或故障恢复。"
      />
      <LoadState error={catalog.error} onRetry={catalog.refresh}>
        <Space direction="vertical" size={20}>
          <Select
            aria-label="仿真设备"
            style={{ width: 260 }}
            value={deviceId}
            disabled={loading}
            onChange={(device) => update({ device }, true)}
            options={catalog.data?.map((d) => ({
              value: d.id,
              label: `${d.name} · ${d.id}`,
            }))}
          />
          <Radio.Group
            aria-label="仿真状态"
            value={mode}
            disabled={loading}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: 'normal', label: '正常' },
              { value: 'degradation', label: '退化' },
              { value: 'fault', label: '故障' },
            ]}
            optionType="button"
          />
          <Button onClick={() => setOpen(true)} disabled={!deviceId}>
            应用仿真状态
          </Button>
        </Space>
      </LoadState>
      {result && (
        <Descriptions style={{ marginTop: 28 }} column={3}>
          <Descriptions.Item label="设备">{result.name}</Descriptions.Item>
          <Descriptions.Item label="健康评分">
            {result.health_score ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="目录状态">
            <StatusTag status={result.status} />
          </Descriptions.Item>
        </Descriptions>
      )}
      <Modal
        title="应用仿真状态"
        open={open}
        onCancel={() => !loading && setOpen(false)}
        onOk={inject}
        confirmLoading={loading}
        maskClosable={!loading}
        cancelButtonProps={{ disabled: loading }}
      >
        <p>将修改 {deviceId} 的目录状态与健康评分。是否继续？</p>
      </Modal>
    </section>
  )
}

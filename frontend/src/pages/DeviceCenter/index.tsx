import { useEffect, useMemo, useState } from 'react'
import { Button, Tabs, Table, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getDevices, type Device } from '../../services/api'
import FaultInjection from '../FaultInjection'

const TYPE_LABEL: Record<string, string> = { pump: '泵', motor: '电机', compressor: '空压机' }
const STATUS_LABEL: Record<string, string> = {
  healthy: '正常',
  degraded: '退化',
  fault: '告警',
  offline: '离线',
}
const STATUS_COLOR: Record<string, string> = {
  healthy: 'green',
  degraded: 'orange',
  fault: 'red',
  offline: 'default',
}

function healthColor(score: number): string {
  if (score > 85) return '#52c41a'
  if (score >= 60) return '#faad14'
  return '#f5222d'
}

/**
 * 设备中心：设备全量列表 + 故障注入（概念演示）。
 * 列表点击「详情」跳转设备详情页（实时曲线 / 隐状态 / 声学频谱 / 健康历史）。
 */
export default function DeviceCenter() {
  const navigate = useNavigate()
  const [devices, setDevices] = useState<Device[]>([])

  useEffect(() => {
    getDevices().then(setDevices).catch(console.error)
  }, [])

  const columns = useMemo(
    () => [
      { title: '设备名称', dataIndex: 'name' },
      { title: '设备ID', dataIndex: 'id' },
      { title: '类型', dataIndex: 'device_type', render: (v: string) => TYPE_LABEL[v] ?? v },
      {
        title: '状态',
        dataIndex: 'status',
        render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{STATUS_LABEL[v] ?? v}</Tag>,
      },
      {
        title: '健康分',
        dataIndex: 'health_score',
        render: (v: number) => (
          <span style={{ fontWeight: 700, color: healthColor(v) }}>{Math.round(v)}</span>
        ),
      },
      {
        title: '边缘异常',
        dataIndex: 'edge_anomaly_score',
        render: (v: number) => `${(v * 100).toFixed(1)}%`,
      },
      {
        title: '操作',
        render: (_: unknown, d: Device) => (
          <Button size="small" type="link" onClick={() => navigate(`/device/${d.id}`)}>
            详情
          </Button>
        ),
      },
    ],
    [navigate],
  )

  const deviceList = (
    <Table
      rowKey="id"
      dataSource={devices}
      columns={columns}
      pagination={false}
      locale={{ emptyText: '暂无设备（可在「系统管理 / 设备管理」中新增）' }}
    />
  )

  return (
    <Tabs
      defaultActiveKey="list"
      items={[
        { key: 'list', label: '设备列表', children: deviceList },
        { key: 'inject', label: '故障注入', children: <FaultInjection /> },
      ]}
    />
  )
}
import { Button, Card, Input, Select, Space, Table, Tabs } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePageQuery, deviceLink } from '../../hooks/usePageQuery'
import { useDeviceCatalog } from '../../services/realtime'
import {
  formatTime,
  LoadState,
  numberText,
  PageHeading,
  SourceTag,
  StatusTag,
  TYPE_LABEL,
} from '../../components/BusinessUI'
import FaultInjection from '../FaultInjection'
import type { Device } from '../../services/api'

export default function DeviceCenter() {
  const navigate = useNavigate()
  const location = useLocation()
  const { params, update } = usePageQuery()
  const resource = useDeviceCatalog()
  const keyword = params.get('q') ?? ''
  const status = params.get('status') ?? 'all'
  // 设备监测页消费 ?device=：作为“当前选中设备”上下文，而不是额外筛选条件
  const selectedDevice = params.get('device') ?? ''
  const selectedName = resource.data?.find(
    (d) => d.id === selectedDevice,
  )?.name
  let isAdmin = false
  try {
    isAdmin = JSON.parse(localStorage.getItem('user') ?? '{}').role === 'admin'
  } catch {
    /* 登录态异常时按普通用户处理 */
  }
  const tab =
    isAdmin && params.get('tab') === 'inject' ? 'inject' : 'list'
  const data = (resource.data ?? []).filter(
    (d) =>
      (status === 'all' || d.status === status) &&
      `${d.name} ${d.id}`.toLowerCase().includes(keyword.toLowerCase()),
  )
  const go = (path: string) =>
    navigate(path, { state: { returnTo: location.pathname + location.search } })
  return (
    <>
      <PageHeading
        title="设备监测"
        meta={
          <>
            <span>{resource.data?.length ?? '—'} 台登记设备</span>
            <SourceTag source="unknown" />
          </>
        }
        actions={
          <Button onClick={resource.refresh} loading={resource.loading}>
            刷新
          </Button>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={(value) =>
          update({ tab: value === 'list' ? undefined : value })
        }
        items={[
          {
            key: 'list',
            label: '设备列表',
            children: (
              <>
                <div className="filter-bar">
                  <Input.Search
                    aria-label="搜索设备"
                    placeholder="搜索设备名称或编号"
                    value={keyword}
                    allowClear
                    onChange={(e) =>
                      update({ q: e.target.value, page: undefined }, true)
                    }
                  />
                  <Select
                    aria-label="设备状态筛选"
                    value={status}
                    onChange={(value) =>
                      update({
                        status: value === 'all' ? undefined : value,
                        page: undefined,
                      })
                    }
                    options={[
                      { value: 'all', label: '全部状态' },
                      { value: 'healthy', label: '正常' },
                      { value: 'degraded', label: '退化' },
                      { value: 'fault', label: '告警' },
                      { value: 'offline', label: '离线' },
                    ]}
                  />
                  {selectedName && (
                    <span className="filter-note">
                      当前选中：{selectedName}
                    </span>
                  )}
                  <span className="filter-end">{data.length} 台匹配设备</span>
                </div>
                <Card>
                  <LoadState error={resource.error} onRetry={resource.refresh}>
                    <Table<Device>
                      rowKey="id"
                      dataSource={data}
                      rowClassName={(d) =>
                        d.id === selectedDevice ? 'row-selected' : ''
                      }
                      loading={resource.loading && !resource.data}
                      scroll={{ x: 850 }}
                      pagination={{
                        current: Math.max(1, Number(params.get('page')) || 1),
                        pageSize: 10,
                        onChange: (page) => update({ page: String(page) }),
                      }}
                      locale={{
                        emptyText:
                          keyword || status !== 'all'
                            ? '没有匹配的设备'
                            : '暂无登记设备',
                      }}
                      columns={[
                        {
                          title: '设备',
                          dataIndex: 'name',
                          render: (name, d) => (
                            <Button
                              type="link"
                              style={{ padding: 0 }}
                              onClick={() =>
                                go(deviceLink('/device/' + encodeURIComponent(d.id)))
                              }
                            >
                              {name}
                            </Button>
                          ),
                        },
                        {
                          title: '设备编号',
                          dataIndex: 'id',
                          render: (id) => (
                            <span style={{ color: '#7a8794', fontSize: 12 }}>
                              {id}
                            </span>
                          ),
                        },
                        {
                          title: '类别',
                          dataIndex: 'device_type',
                          render: (type) => TYPE_LABEL[type] ?? type,
                        },
                        {
                          title: '目录状态',
                          dataIndex: 'status',
                          render: (v) => <StatusTag status={v} />,
                        },
                        {
                          title: '健康评分',
                          dataIndex: 'health_score',
                          render: (v) => numberText(v, 0),
                        },
                        {
                          title: '边缘异常',
                          dataIndex: 'edge_anomaly_score',
                          render: (v) =>
                            typeof v === 'number'
                              ? `${(v * 100).toFixed(1)}%`
                              : '—',
                        },
                        {
                          title: '目录更新时间',
                          dataIndex: 'last_updated',
                          render: (v) => (
                            <span style={{ fontSize: 12 }}>
                              {formatTime(v)}
                            </span>
                          ),
                        },
                        {
                          title: '操作',
                          render: (_, d) => (
                            <Space>
                              <Button
                                size="small"
                                onClick={() =>
                                  go(deviceLink('/device/' + encodeURIComponent(d.id)))
                                }
                              >
                                详情
                              </Button>
                              <Button
                                size="small"
                                type="link"
                                onClick={() =>
                                  go(deviceLink('/diagnose', d.id))
                                }
                              >
                                诊断
                              </Button>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </LoadState>
                </Card>
              </>
            ),
          },
          ...(isAdmin
            ? [
                {
                  key: 'inject',
                  label: '仿真测试',
                  children: <FaultInjection />,
                },
              ]
            : []),
        ]}
      />
    </>
  )
}

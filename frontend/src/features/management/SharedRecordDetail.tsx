import { Button, Card, Space } from 'antd'
import { useParams } from 'react-router-dom'
import DiagnosisSummary from '../../components/DiagnosisSummary'
import { LoadState, PageHeading, StatusTag, formatTime } from '../../components/BusinessUI'
import { useResource } from '../../hooks/useResource'
import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { getEvent } from '../../services/api'
import Timeline from '../../pages/Timeline'
import './management.css'

export default function SharedRecordDetail() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useSpatialNavigate()
  const id = eventId && /^[1-9]\d*$/.test(eventId) ? Number(eventId) : undefined
  const resource = useResource(`shared-record:${eventId}`, () => getEvent(id!), 10000, Boolean(id))
  const event = resource.data
  return (
    <div className="management-record-detail">
      <PageHeading
        title={`诊断记录${id ? ` #${id}` : ''}`}
        meta={event && <><span>{event.device_id}</span><span>{formatTime(event.timestamp)}</span><StatusTag status={event.status_state} event /></>}
        actions={<Space wrap>
          <Button onClick={() => navigate('/manage/records')}>全部记录</Button>
          {event && <Button onClick={() => navigate(`/manage/devices/${encodeURIComponent(event.device_id)}`)}>设备详情</Button>}
          {event && <Button type="primary" onClick={() => navigate(`/tools/events?device=${encodeURIComponent(event.device_id)}&event=${event.id}`)}>事件处置与报告</Button>}
        </Space>}
      />
      <LoadState loading={resource.loading && !event} error={resource.error} onRetry={resource.refresh} empty={!id} emptyText="记录编号无效，请从诊断记录列表重新选择。">
        {event && <>
          <Card className="management-record-summary"><DiagnosisSummary event={event} /></Card>
          <Card title="事件证据与时间线"><Timeline eventId={event.id} /></Card>
        </>}
      </LoadState>
    </div>
  )
}

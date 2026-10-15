import { useEffect, useState } from 'react'
import { Button, Card, Col, Empty, List, Row, Space, Tabs, Typography, message } from 'antd'
import ReactMarkdown from 'react-markdown'
import { getEventReport, getFlashReport, listEvents, type EventSummary } from '../../services/api'

const { Paragraph } = Typography

export default function ReportCenter() {
  const [flashText, setFlashText] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [events, setEvents] = useState<EventSummary[]>([])
  const [activeContent, setActiveContent] = useState<'none' | 'flash' | 'report'>('none')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    listEvents({ limit: 20 }).then(setEvents).catch(console.error)
  }, [])

  const genFlash = async () => {
    setLoading(true)
    try {
      const r = await getFlashReport({})
      setFlashText(r.report)
      setActiveContent('flash')
    } catch {
      message.error('生成快报失败')
    } finally {
      setLoading(false)
    }
  }

  const viewReport = async (id: number) => {
    setLoading(true)
    try {
      const r = await getEventReport(id)
      setMarkdown(r.report)
      setActiveContent('report')
    } catch {
      message.error('生成报告失败')
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    const text = activeContent === 'report' ? markdown : flashText
    navigator.clipboard?.writeText(text).then(
      () => message.success('已复制到剪贴板'),
      () => message.error('复制失败'),
    )
  }

  const tabs = [
    {
      key: 'flash',
      label: '快报',
      children: (
        <div>
          <Button type="primary" onClick={genFlash} loading={loading}>
            生成快报
          </Button>
          <Paragraph style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{flashText}</Paragraph>
        </div>
      ),
    },
    {
      key: 'events',
      label: '事件报告',
      children: (
        <List
          size="small"
          dataSource={events}
          locale={{ emptyText: '暂无事件' }}
          renderItem={(e) => (
            <List.Item onClick={() => viewReport(e.id)} style={{ cursor: 'pointer' }}>
              <List.Item.Meta
                title={`#${e.id} · ${e.device_id}`}
                description={e.timestamp ? new Date(e.timestamp).toLocaleString() : ''}
              />
            </List.Item>
          )}
        />
      ),
    },
  ]

  return (
    <Row gutter={16}>
      <Col xs={24} md={8}>
        <Card title="报告列表">
          <Tabs items={tabs} />
        </Card>
      </Col>
      <Col xs={24} md={16}>
        <Card
          title="报告详情"
          extra={
            <Space>
              <Button onClick={copy} disabled={activeContent === 'none'}>
                复制 Markdown
              </Button>
              <Button onClick={() => window.print()} disabled={activeContent === 'none'}>
                打印
              </Button>
            </Space>
          }
        >
          {activeContent === 'none' && <Empty description="生成或选择一份报告" />}
          {activeContent === 'flash' && (
            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{flashText}</Paragraph>
          )}
          {activeContent === 'report' && (
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </div>
          )}
        </Card>
      </Col>
    </Row>
  )
}
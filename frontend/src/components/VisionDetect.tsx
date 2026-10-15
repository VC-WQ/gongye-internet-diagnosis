import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Image, Row, Select, Spin, Table, Tag, Upload, message } from 'antd'
import { InboxOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { detectVision, getVisionComparison, getVisionModels, getVisionSamples } from '../services/api'
import ChartNote from './ChartNote'

const cardBodyStyle = { padding: 12 }

interface Detection {
  class: string
  label: string
  confidence: number
  bbox: number[]
}

interface DetectResult {
  model: string
  count: number
  detections: Detection[]
  annotated_image: string
}

interface SampleItem {
  class: string
  label: string
  image: string
}

interface ComparisonModel {
  name: string
  mAP50: number
  mAP50_95: number
  precision: number
  recall: number
  fps: number
  params_M: number
  imgsz: number
}

// 模型中文名（用于对比表与结论）
const MODEL_NAME: Record<string, string> = {
  yolov8s: 'YOLOv8s（一阶段·边缘）',
  rtdetr: 'RT-DETR（Transformer·云端）',
}

/**
 * 视觉检测智能体（NEU-DET 训练的 YOLOv8 目标检测落地）。
 *
 * 交互式演示：
 *   1. 上传缺陷图片 → 后端 YOLOv8 推理 → 返回缺陷定位 + 类别 + 置信度 + 标注图
 *   2. 展示 6 类缺陷的检测样例图墙（真实训练产物）
 * 落点：目标检测（定位缺陷位置）才有工业价值，是第 5 个智能体（视觉），
 *       与「信号诊断」等表格/时序智能体互补，体现多模态闭环。
 */
export default function VisionDetect() {
  const [models, setModels] = useState<Array<{ name: string; imgsz: number }>>([])
  const [model, setModel] = useState('yolov8s')
  const [samples, setSamples] = useState<SampleItem[]>([])
  const [comparison, setComparison] = useState<ComparisonModel[]>([])
  const [file, setFile] = useState<File>()
  const [preview, setPreview] = useState<string>()
  const [result, setResult] = useState<DetectResult>()
  const [detecting, setDetecting] = useState(false)
  const [loading, setLoading] = useState(true)

  // 加载可用模型 + 样例图
  useEffect(() => {
    let active = true
    getVisionModels()
      .then((d) => {
        if (!active) return
        const ms = d?.models ?? []
        setModels(ms)
        setModel(ms[0]?.name ?? 'yolov8s')
      })
      .catch(() => {})
    getVisionSamples('yolov8s')
      .then((d) => {
        if (active) setSamples(d?.samples ?? [])
      })
      .catch(() => {})
    getVisionComparison()
      .then((d) => {
        if (active) setComparison(d?.models ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const beforeUpload = (f: File) => {
    setFile(f)
    setResult(undefined)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(f)
    return false // 阻止自动上传，手动触发检测
  }

  const runDetect = async () => {
    if (!file) {
      message.warning('请先上传一张缺陷图片')
      return
    }
    setDetecting(true)
    try {
      const r = await detectVision(file, model)
      setResult(r)
      if (r?.count === 0) message.info('未检测到缺陷（可能不是目标缺陷类型）')
    } catch (e) {
      message.error('检测失败，请稍后重试')
    } finally {
      setDetecting(false)
    }
  }

  const modelOptions = useMemo(
    () => models.map((m) => ({ value: m.name, label: `${m.name}（输入 ${m.imgsz}×${m.imgsz}）` })),
    [models],
  )

  // 双模型对比表行（自动标记"哪个更优"）
  const cmpRows = useMemo(() => {
    const y = comparison.find((m) => m.name === 'yolov8s')
    const r = comparison.find((m) => m.name === 'rtdetr')
    if (!y || !r) return []
    const metrics: Array<{
      label: string
      yolo: number
      rtdetr: number
      higherBetter: boolean
      fmt: (n: number) => string
    }> = [
      { label: 'mAP50', yolo: y.mAP50, rtdetr: r.mAP50, higherBetter: true, fmt: (n) => (n * 100).toFixed(1) + '%' },
      { label: 'mAP50-95', yolo: y.mAP50_95, rtdetr: r.mAP50_95, higherBetter: true, fmt: (n) => (n * 100).toFixed(1) + '%' },
      { label: '精确率', yolo: y.precision, rtdetr: r.precision, higherBetter: true, fmt: (n) => (n * 100).toFixed(1) + '%' },
      { label: '召回率', yolo: y.recall, rtdetr: r.recall, higherBetter: true, fmt: (n) => (n * 100).toFixed(1) + '%' },
      { label: '推理速度 FPS', yolo: y.fps, rtdetr: r.fps, higherBetter: true, fmt: (n) => Math.round(n).toString() },
      { label: '参数量', yolo: y.params_M, rtdetr: r.params_M, higherBetter: false, fmt: (n) => n.toFixed(2) + 'M' },
    ]
    return metrics.map((m) => {
      const winner = m.higherBetter
        ? (m.yolo >= m.rtdetr ? 'yolov8s' : 'rtdetr')
        : (m.yolo <= m.rtdetr ? 'yolov8s' : 'rtdetr')
      return { label: m.label, yolo: m.fmt(m.yolo), rtdetr: m.fmt(m.rtdetr), winner: winner as 'yolov8s' | 'rtdetr' }
    })
  }, [comparison])

  return (
    <Spin spinning={loading}>
      <Row gutter={16}>
        <Col span={24} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#22d3ee' }}>
            关键部件表面缺陷视觉检测
            <Tag color="cyan" style={{ marginLeft: 8, fontWeight: 400 }}>
              多模态协同诊断 · 视觉分支
            </Tag>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.8 }}>
            面向旋转机械<b>关键部件表面损伤</b>的自动识别：轴承滚道/滚动体、齿轮齿面、
            泵与空压机叶轮、密封面。适用于<b>解体检修</b>与<b>内窥镜检查</b>场景。
            检测结果作为<b>第五路证据</b>送入智能会诊，与振动诊断交叉验证
            ——振动看动态响应，视觉看表面形貌，二者判的是同一类失效的不同表现。
          </div>
          <div style={{ fontSize: 11, color: '#78879b', marginTop: 4, lineHeight: 1.8 }}>
            模型在 <b>NEU-DET 公开基准数据集</b>（东北大学 1800 张 200×200 标注图）上训练与验证。
            该数据集的<b>点蚀、划痕、裂纹</b>三类缺陷形态与旋转部件表面损伤同源
            （轴承点蚀正是内/外圈故障的物理成因），故可将学到的表面损伤检测能力迁移应用于设备部件检测。
            <span style={{ color: '#faad14' }}>
              注：模型训练域为钢材表面，迁移至设备部件存在域差异，因此视觉证据在会诊中按<b>弱证据</b>参与融合。
            </span>
          </div>
        </Col>

        {/* NEU-DET 缺陷类型 → 旋转机械部件失效模式 映射 */}
        <Col span={24} style={{ marginBottom: 16 }}>
          <Card
            title="缺陷类型 → 设备部件失效模式 映射"
            size="small"
            styles={{ body: { padding: 12 } }}
          >
            <Table
              size="small"
              pagination={false}
              rowKey="defect"
              columns={[
                { title: 'NEU-DET 缺陷', dataIndex: 'defect', key: 'defect', width: 130 },
                { title: '部件失效模式', dataIndex: 'mode', key: 'mode' },
                { title: '关联部件', dataIndex: 'part', key: 'part', width: 160 },
                {
                  title: '与振动诊断的关联',
                  dataIndex: 'link',
                  key: 'link',
                  render: (v: string) => (
                    <Tag color={v === '强' ? 'red' : v === '中' ? 'orange' : 'default'}>{v}</Tag>
                  ),
                  width: 130,
                },
              ]}
              dataSource={[
                { defect: '点蚀 pitted', mode: '滚道/滚动体点蚀、齿面点蚀', part: '轴承、齿轮', link: '强' },
                { defect: '划痕 scratches', mode: '滚道划伤、轴颈拉伤、密封面划伤', part: '轴承、密封', link: '强' },
                { defect: '裂纹 crazing', mode: '叶轮裂纹、齿根裂纹、保持架裂纹', part: '泵/空压机叶轮、齿轮', link: '强' },
                { defect: '斑块 patches', mode: '磨损斑、胶合区', part: '齿轮、滑动轴承', link: '中' },
                { defect: '夹杂 inclusion', mode: '材料夹杂（制造缺陷，诱发早期失效）', part: '制造质量溯源', link: '中' },
                { defect: '氧化 rolled-in', mode: '锈蚀、高温氧化层', part: '空压机、高温部件', link: '中' },
              ]}
            />
            <div style={{ fontSize: 11, color: '#78879b', marginTop: 8, lineHeight: 1.8 }}>
              「关联=强」的三类（点蚀/划痕/裂纹）正是旋转机械的典型失效模式，
              可与振动诊断形成直接互证；其余三类作为辅助判据。
            </div>
          </Card>
        </Col>

        {/* 左：上传 + 检测 */}
        <Col xs={24} lg={10}>
          <Card title="上传缺陷图片检测" styles={{ body: cardBodyStyle }}>
            <Upload.Dragger
              accept="image/*"
              beforeUpload={beforeUpload}
              showUploadList={false}
              style={{ padding: '12px 0' }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽图片到此区域</p>
              <p className="ant-upload-hint">支持 JPG/PNG，200×200 灰度缺陷图效果最佳</p>
            </Upload.Dragger>

            {preview && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <img src={preview} alt="原图" style={{ maxWidth: 220, maxHeight: 180 }} />
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>模型</span>
              <Select
                style={{ flex: 1 }}
                options={modelOptions}
                value={model}
                onChange={(v) => {
                  setModel(v)
                  setResult(undefined)
                }}
              />
            </div>

            <Button
              type="primary"
              block
              icon={<ThunderboltOutlined />}
              loading={detecting}
              onClick={runDetect}
              style={{ marginTop: 12 }}
            >
              开始检测{model ? `（${model}）` : ''}
            </Button>
          </Card>
        </Col>

        {/* 右：检测结果 */}
        <Col xs={24} lg={14}>
          <Card
            title="检测结果"
            styles={{ body: cardBodyStyle }}
            extra={
              result ? (
                <Tag color={result.count > 0 ? 'red' : 'green'}>
                  {result.count > 0 ? `检出 ${result.count} 处缺陷` : '未检出缺陷'}
                </Tag>
              ) : null
            }
          >
            {result ? (
              <Row gutter={12}>
                <Col span={12}>
                  {result.annotated_image ? (
                    <img
                      src={result.annotated_image}
                      alt="检测标注图"
                      style={{ width: '100%', maxHeight: 300, objectFit: 'contain' }}
                    />
                  ) : (
                    <Empty description="无标注图" />
                  )}
                </Col>
                <Col span={12}>
                  {result.detections.length ? (
                    <div>
                      {result.detections.map((d, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '8px 12px',
                            marginBottom: 8,
                            background: 'rgba(250, 140, 22, 0.12)',
                            borderRadius: 6,
                            border: '1px solid rgba(250, 140, 22, 0.35)',
                          }}
                        >
                          <div>
                            <b>{d.label}</b>{' '}
                            <Tag color="red">{(d.confidence * 100).toFixed(1)}%</Tag>
                          </div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>
                            位置 [{d.bbox.map((v) => Math.round(v)).join(', ')}]
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty description="该图未检出已知缺陷类别" />
                  )}
                </Col>
              </Row>
            ) : (
              <Empty description="上传图片并点击「开始检测」后查看结果" />
            )}
          </Card>
        </Col>

        {/* 样例图墙 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="6 类缺陷检测样例（训练集真实推理产物）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="6 类钢铁表面缺陷（裂纹/夹杂/斑块/点蚀/氧化铁皮/划痕）各一张模型推理标注样例图墙。"
                dataSource="NEU-DET 带钢表面缺陷数据集（东北大学，1800 张 200×200 灰度图 + VOC 标注，真实公开数据）。"
                insight="直观展示视觉检测智能体可识别的缺陷类型与定位效果。"
              />
            }
          >
            {samples.length ? (
              <Row gutter={[12, 12]}>
                {samples.map((s) => (
                  <Col xs={12} sm={8} lg={4} key={s.class}>
                    <div style={{ textAlign: 'center' }}>
                      <Image
                        src={s.image}
                        alt={s.label}
                        width="100%"
                        style={{ borderRadius: 6, maxHeight: 160, objectFit: 'contain' }}
                      />
                      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.class}</div>
                    </div>
                  </Col>
                ))}
              </Row>
            ) : (
              <Empty description="样例图准备中" />
            )}
          </Card>
        </Col>

        {/* 双模型精度-速度权衡 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="双模型精度-速度权衡（工业部署选型）"
            styles={{ body: cardBodyStyle }}
            extra={
              <ChartNote
                desc="YOLOv8s（一阶段·边缘）与 RT-DETR（Transformer·云端）在 mAP/精确率/召回/FPS/参数量上的对比。"
                dataSource="NEU-DET 带钢表面缺陷训练产出的两个模型（YOLOv8s 与 RT-DETR 验证结果，真实公开数据）。"
                insight="RT-DETR 精度略高，YOLOv8s 推理快约 4 倍——边缘实时选 YOLOv8s，云端高精度选 RT-DETR。"
              />
            }
          >
            {cmpRows.length ? (
              <>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12, lineHeight: 1.7 }}>
                  RT-DETR（Transformer）精度略高，但 YOLOv8s 推理快约 4 倍、参数少约 3 倍——
                  结论：<b style={{ color: '#22d3ee' }}>边缘实时部署选 YOLOv8s，云端高精度场景选 RT-DETR</b>。
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.18)', color: '#94a3b8', fontWeight: 500 }}>
                        指标
                      </th>
                      <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.18)', color: '#94a3b8', fontWeight: 600 }}>
                        {MODEL_NAME.yolov8s}
                      </th>
                      <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.18)', color: '#94a3b8', fontWeight: 600 }}>
                        {MODEL_NAME.rtdetr}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmpRows.map((row) => (
                      <tr key={row.label}>
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.08)', color: '#94a3b8' }}>
                          {row.label}
                        </td>
                        <td
                          style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid rgba(148,163,184,0.08)',
                            textAlign: 'center',
                            fontWeight: row.winner === 'yolov8s' ? 700 : 400,
                            color: row.winner === 'yolov8s' ? '#22d3ee' : '#e6edf7',
                          }}
                        >
                          {row.yolo}
                        </td>
                        <td
                          style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid rgba(148,163,184,0.08)',
                            textAlign: 'center',
                            fontWeight: row.winner === 'rtdetr' ? 700 : 400,
                            color: row.winner === 'rtdetr' ? '#22d3ee' : '#e6edf7',
                          }}
                        >
                          {row.rtdetr}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <Empty description="对比数据准备中" />
            )}
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
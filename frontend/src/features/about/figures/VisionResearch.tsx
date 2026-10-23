import { Button, Card, Table } from 'antd'
import ChartNote from '../../../components/ChartNote'
import { LoadState } from '../../../components/BusinessUI'
import { getVisionComparison } from '../../../services/api'
import { useResource } from '../../../hooks/useResource'
import { useSpatialNavigate } from '../../../hooks/useSpatialNavigate'

interface VisionModel {
  name: string
  mAP50: number
  mAP50_95: number
  precision: number
  recall: number
  fps: number
  params_M: number
  imgsz: number
}

const NAME: Record<string, string> = {
  yolov8s: 'YOLOv8s（一阶段 · 边缘）',
  rtdetr: 'RT-DETR（Transformer · 云端）',
}

export default function VisionResearch() {
  const navigate = useSpatialNavigate()
  const resource = useResource('viz-vision-comparison', getVisionComparison)
  const models: VisionModel[] = resource.data?.models ?? []
  return (
    <LoadState
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.refresh}
      empty={!resource.loading && !models.length}
      emptyText="暂无视觉模型对照数据"
    >
      <Card
        title="部件缺陷检测模型对照（NEU-DET）"
        extra={
          <div className="research-card-actions">
            <ChartNote
              desc="YOLOv8s 与 RT-DETR 在 NEU-DET 缺陷检测验证集上的精度、召回、速度与参数量对比。"
              dataSource="NEU-DET 钢材表面缺陷数据集训练产物（6 类缺陷，真实公开数据）。"
              insight="对照两者的精度—速度权衡，解释边缘侧模型选择。"
            />
            <Button size="small" onClick={() => navigate('/tools/vision')}>
              打开缺陷检测工具
            </Button>
          </div>
        }
      >
        <Table
          size="small"
          rowKey="name"
          pagination={false}
          scroll={{ x: 760 }}
          dataSource={models}
          columns={[
            {
              title: '模型',
              dataIndex: 'name',
              render: (value: string) => NAME[value] ?? value,
            },
            { title: 'mAP@50', dataIndex: 'mAP50' },
            { title: 'mAP@50-95', dataIndex: 'mAP50_95' },
            { title: '精确率', dataIndex: 'precision' },
            { title: '召回率', dataIndex: 'recall' },
            { title: 'FPS', dataIndex: 'fps' },
            { title: '参数量 (M)', dataIndex: 'params_M' },
            { title: '输入尺寸', dataIndex: 'imgsz' },
          ]}
        />
        <p className="research-inline-note">
          上传检测与样例图墙属于工具区实操入口；本页只保留可复核的模型对照结果。
        </p>
      </Card>
    </LoadState>
  )
}

import { useState } from 'react'
import { Button, Space, Tag } from 'antd'
import type { PicoEmotion } from '../core/types'
import PicoAvatar from './PicoAvatar'

const EMOTIONS: PicoEmotion[] = [
  'idle',
  'curious',
  'thinking',
  'search',
  'talking',
  'happy',
  'alert',
  'confused',
]

/**
 * Pico 表情实验室（仅开发模式）。
 * 只测试表现层，不触发真实业务事件，也不伪造告警。
 */
export default function PicoLab() {
  const [emotion, setEmotion] = useState<PicoEmotion>('idle')

  return (
    <section className="surface" style={{ marginTop: 24 }}>
      <div className="section-header">
        <h2>Pico 表情实验室</h2>
        <Tag>仅表现测试 · 不触发业务</Tag>
      </div>
      <Space wrap>
        {EMOTIONS.map((item) => (
          <Button
            key={item}
            type={emotion === item ? 'primary' : 'default'}
            onClick={() => setEmotion(item)}
          >
            {item}
          </Button>
        ))}
      </Space>
      <div
        style={{
          display: 'flex',
          gap: 32,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 20,
        }}
      >
        <PicoAvatar emotion={emotion} size={230} />
        <PicoAvatar emotion={emotion} size={84} />
        <PicoAvatar emotion={emotion} size={44} />
      </div>
      <p className="page-meta">
        检查 84px 悬浮版与 230px 展开版的表情、呼吸与软体形变；生产环境不显示本面板。
      </p>
    </section>
  )
}

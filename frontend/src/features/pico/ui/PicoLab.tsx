import { Button, Select, Space, Tag } from 'antd'
import { usePico } from '../core/PicoProvider'
import { PICO_EMOTIONS } from '../animation/controller'
import SlidingChoice from '../../../components/SlidingChoice'
import { EMOTION_LABELS } from '../core/emotionLabels'
import { stopChineseSpeech } from '../../../services/speech'

export interface PicoPresentation {
  size: number
  rotation: number
  speed: number
  reducedMotion?: boolean
}
/** Development-only presentation controls, rendered only inside the Pico workbench. */
export default function PicoLab({ presentation, onPresentation }: {
  presentation: PicoPresentation
  onPresentation: (value: PicoPresentation) => void
}) {
  const {
    emotion,
    previewEmotion,
    speechAvailable,
    speak,
    stopSpeaking,
  } = usePico()
  const startVoice = () => {
    speak(
      '你好，我是 Pico。这段语音用于检查播放开始、暂停、继续与停止时，表情能否连续响应。',
    )
  }
  const renderedEmotion = emotion
  return (
    <section className="pico-lab" data-pico-lab>
      <div className="pico-lab__head">
        <h2>Pico 表情测试</h2>
        <Tag>仅开发环境 · 不触发业务</Tag>
      </div>
      <p className="pico-lab__hint">
        选择表情，查看角色变化；播放语音可检查暂停、继续与停止时的动作。
      </p>
      <SlidingChoice value={renderedEmotion} options={PICO_EMOTIONS.map(value=>({value,label:EMOTION_LABELS[value]}))}
        label="Pico 表情" dataPrefix="data-pico-emotion" onChange={value=>{stopChineseSpeech();previewEmotion(value)}} />
      <div className="pico-lab__presentation">
        <label>观察尺寸
          <Select<number> aria-label="Pico 观察尺寸" value={presentation.size}
            onChange={size => onPresentation({ ...presentation, size })}
            options={[44, 76, 84, 160, 230].map(value => ({ value, label: `${value}px ${({44:'紧凑',76:'悬浮窗',84:'工作台',160:'观察',230:'细节'} as Record<number,string>)[value]}` }))} />
        </label>
        <label>观察角度
          <input type="range" min={-60} max={60} step={5} aria-label="Pico 观察角度"
            value={Math.round(presentation.rotation * 180 / Math.PI)}
            onChange={(event) => onPresentation({ ...presentation, rotation: Number(event.target.value) * Math.PI / 180 })} />
          <output>{Math.round(presentation.rotation * 180 / Math.PI)}°</output>
        </label>
        <label>动作速度
          <Select<number> aria-label="Pico 动作速度" value={presentation.speed}
            onChange={speed => onPresentation({ ...presentation, speed })}
            options={[{ value: 1, label: '自然速度' }, { value: .25, label: '0.25× 慢动作' }, { value: 0, label: '暂停' }]} />
        </label>
        <label><input type="checkbox" checked={presentation.reducedMotion === true}
          onChange={(event) => onPresentation({ ...presentation, reducedMotion: event.target.checked ? true : undefined })} />减少动态效果</label>
      </div>
      <Space wrap style={{ marginTop: 14 }}>
        <Button size="small" onClick={startVoice} disabled={!speechAvailable}>
          播放测试语音
        </Button>
        <Button size="small" onClick={() => window.speechSynthesis?.pause()}>
          暂停
        </Button>
        <Button size="small" onClick={() => window.speechSynthesis?.resume()}>
          继续
        </Button>
        <Button size="small" onClick={stopSpeaking}>
          停止
        </Button>
        <span className="page-meta" role="status" data-pico-emotion-state={emotion}>
          表情：{EMOTION_LABELS[emotion]}
        </span>
      </Space>
    </section>
  )
}

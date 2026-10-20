import { Button, Space, Tag } from 'antd'
import { usePico } from '../core/PicoProvider'
import { PICO_EMOTIONS } from '../animation/controller'
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
        <h2>Pico 状态矩阵</h2>
        <Tag>仅开发环境 · 不触发业务</Tag>
      </div>
      <p className="pico-lab__hint">
        点击表情按钮后观察左上角同一个三维角色；语音表情跟随真实 start/resume 事件。
      </p>
      <Space wrap>
        {PICO_EMOTIONS.map((item) => (
          <Button
            key={item}
            size="small"
            type={renderedEmotion === item ? 'primary' : 'default'}
            onClick={() => {
              stopChineseSpeech()
              previewEmotion(item)
            }}
            data-pico-emotion={item}
          >
            {item}
          </Button>
        ))}
      </Space>
      <div className="pico-lab__presentation">
        <label>观察尺寸
          <select aria-label="Pico 观察尺寸" value={presentation.size}
            onChange={(event) => onPresentation({ ...presentation, size: Number(event.target.value) })}>
            <option value={44}>44px 紧凑</option><option value={76}>76px Dock</option><option value={84}>84px 工作台</option><option value={160}>160px 观察</option><option value={230}>230px 细节</option>
          </select>
        </label>
        <label>观察角度
          <input type="range" min={-60} max={60} step={5} aria-label="Pico 观察角度"
            value={Math.round(presentation.rotation * 180 / Math.PI)}
            onChange={(event) => onPresentation({ ...presentation, rotation: Number(event.target.value) * Math.PI / 180 })} />
          <output>{Math.round(presentation.rotation * 180 / Math.PI)}°</output>
        </label>
        <label>动作速度
          <select aria-label="Pico 动作速度" value={presentation.speed}
            onChange={(event) => onPresentation({ ...presentation, speed: Number(event.target.value) })}>
            <option value={1}>自然速度</option><option value={0.25}>0.25× 慢动作</option><option value={0}>暂停</option>
          </select>
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
          表情：{emotion}
        </span>
      </Space>
    </section>
  )
}

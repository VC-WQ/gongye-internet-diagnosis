import { Button, Space, Tag } from 'antd'
import { usePico } from '../core/PicoProvider'
import { PICO_EMOTIONS } from '../animation/controller'
import { stopChineseSpeech } from '../../../services/speech'

/** Development-only presentation controls, rendered only inside the Pico workbench. */
export default function PicoLab() {
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

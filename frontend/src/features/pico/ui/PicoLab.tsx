import { useEffect, useRef, useState } from 'react'
import { Button, Space, Tag } from 'antd'
import type { PicoEmotion } from '../core/types'
import { PICO_EMOTIONS } from '../animation/controller'
import { speakChinese, stopChineseSpeech } from '../../../services/speech'
import PicoAvatar from './PicoAvatar'

/** Development-only presentation controls. No device events or physical commands. */
export default function PicoLab() {
  const [emotion, setEmotion] = useState<PicoEmotion>('idle')
  const [speed, setSpeed] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [reduced, setReduced] = useState(false)
  const [voiceState, setVoiceState] = useState('未播放')
  const [voiceActive, setVoiceActive] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; stopChineseSpeech() }
  }, [])
  const startVoice = () => {
    const started = speakChinese(
      '你好，我是 Pico。这段语音用于检查真实播放开始、暂停、继续与停止时，表情能否连续响应。',
      () => { if (alive.current) setVoiceActive(false) },
      (state) => {
        if (!alive.current) return
        setVoiceState(state)
        setVoiceActive(state === 'start' || state === 'resume')
      },
    )
    if (!started) { setVoiceState('当前浏览器不支持语音'); setVoiceActive(false) }
  }
  const renderedEmotion = voiceActive ? 'talking' : emotion
  return (
    <section className="surface" style={{ marginTop: 24 }} data-pico-lab>
      <div className="section-header"><h2>Pico 动画实验室</h2><Tag>仅表现测试 · 不触发业务</Tag></div>
      <Space wrap>
        {PICO_EMOTIONS.map((item) => (
          <Button key={item} type={emotion === item ? 'primary' : 'default'} onClick={() => {
            stopChineseSpeech(); setVoiceActive(false); setEmotion(item)
          }} data-pico-emotion={item}>{item}</Button>
        ))}
      </Space>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, marginTop: 18 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          转向 {rotation}°
          <input aria-label="Pico 三维转向" type="range" min={-90} max={90} step={1}
            value={rotation} onChange={(event) => setRotation(Number(event.target.value))} />
        </label>
        <Space wrap>
          <Button type={speed === 1 ? 'primary' : 'default'} onClick={() => setSpeed(1)}>正常速度</Button>
          <Button type={speed === 0.25 ? 'primary' : 'default'} onClick={() => setSpeed(0.25)}>0.25× 慢放</Button>
          <Button type={speed === 0 ? 'primary' : 'default'} onClick={() => setSpeed(0)}>暂停动作</Button>
        </Space>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} />减弱动态效果
        </label>
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', marginTop: 20 }}>
        {[230, 84, 44].map((size) => <div key={size} style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
          <PicoAvatar emotion={renderedEmotion} size={size} rotation={rotation * Math.PI / 180}
            speed={speed} reducedMotion={reduced ? true : undefined} />
          <span className="page-meta">{size}px</span>
        </div>)}
      </div>
      <Space wrap style={{ marginTop: 18 }}>
        <Button onClick={startVoice}>播放测试语音</Button>
        <Button onClick={() => window.speechSynthesis?.pause()}>暂停语音</Button>
        <Button onClick={() => window.speechSynthesis?.resume()}>继续语音</Button>
        <Button onClick={() => { stopChineseSpeech(); setVoiceActive(false) }}>停止语音</Button>
        <span className="page-meta" role="status" data-pico-voice-state={voiceState}>语音：{voiceState}</span>
      </Space>
      <p className="page-meta" style={{ marginBottom: 0, marginTop: 16 }}>
        拖动转向检查球面屏幕贴合；慢放检查左侧笔画闭合、局部挤压与回弹。语音表情跟随实际播放事件，生产环境不显示本面板。
      </p>
    </section>
  )
}

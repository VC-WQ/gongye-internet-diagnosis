import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * 数字人 3D 形象组件。
 *
 * 基于 Three.js 程序化构建一个全息风格的 AI 诊断助手头像（无需外部模型文件）：
 *   - 头部 / 身体 / 胸口能量核心 / 领口光环 / 全息底环 / 环绕粒子
 *   - 待机动画：轻微浮动、转头、眨眼、底环旋转、粒子环绕
 *   - 说话动画：嘴巴开合、底环与能量核心脉冲
 *   - 情绪联动：脸色（眼睛/嘴巴/光环）随 mood 变色
 *
 * 情绪配色沿用大屏主题的语义色：
 *   healthy（健康=电光青）、degraded（预警=琥珀）、fault（故障=红）、idle（待机=亮天蓝）
 */
export type DigitalMood = 'idle' | 'healthy' | 'degraded' | 'fault'

const MOOD_COLOR: Record<DigitalMood, number> = {
  idle: 0x38bdf8,
  healthy: 0x22d3ee,
  degraded: 0xfaad14,
  fault: 0xf5222d,
}

/** 后端 health_level -> 数字人情绪。health_level 取值：healthy / warning / abnormal */
export function moodFromHealthLevel(level: string | undefined): DigitalMood {
  if (level === 'abnormal') return 'fault'
  if (level === 'warning') return 'degraded'
  if (level === 'healthy') return 'healthy'
  return 'idle'
}

// ---------------------------------------------------------------------------
// 中文语音播报（Web Speech API，浏览器内置 TTS，离线可用）
// ---------------------------------------------------------------------------
let zhVoice: SpeechSynthesisVoice | undefined

function cacheVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const vs = window.speechSynthesis.getVoices() ?? []
  zhVoice =
    vs.find((v) => /zh[-_]CN/i.test(v.lang)) ??
    vs.find((v) => /^zh/i.test(v.lang)) ??
    vs.find((v) => /chinese|CMN/i.test(v.name))
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  cacheVoices()
  window.speechSynthesis.onvoiceschanged = cacheVoices
}

/** 用中文语音朗读文本；返回是否成功发起（浏览器支持且文本非空）。 */
export function speakChinese(text: string, onEnd?: () => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return false
  window.speechSynthesis.cancel()
  cacheVoices()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  if (zhVoice) u.voice = zhVoice
  u.rate = 1.02
  u.pitch = 1
  if (onEnd) u.onend = onEnd
  window.speechSynthesis.speak(u)
  return true
}

/** 立即停止当前语音播报。 */
export function stopChineseSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

interface DigitalHuman3DProps {
  /** 情绪状态，影响脸色配色 */
  mood?: DigitalMood
  /** 是否正在说话（驱动嘴巴/底环动画） */
  speaking?: boolean
  /** 头像最大宽度（正方形渲染，实际随容器宽度自适应） */
  size?: number
  style?: React.CSSProperties
}

export default function DigitalHuman3D({
  mood = 'idle',
  speaking = false,
  size = 300,
  style,
}: DigitalHuman3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const moodRef = useRef(mood)
  const speakingRef = useRef(speaking)
  moodRef.current = mood
  speakingRef.current = speaking

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    camera.position.set(0, 0.35, 5.4)
    camera.lookAt(0, -0.1, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    // 灯光：环境光 + 主光 + 青色轮廓光
    scene.add(new THREE.AmbientLight(0xaabbdd, 1.3))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(2.5, 3, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x22d3ee, 1.6)
    rim.position.set(-2.5, -1, -3)
    scene.add(rim)

    const root = new THREE.Group()
    scene.add(root)

    const moodColor = (): THREE.Color => new THREE.Color(MOOD_COLOR[moodRef.current])

    // ---- 头部 ----
    const head = new THREE.Group()
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x1c2b40, roughness: 0.45, metalness: 0.45 })
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.88, 48, 32), skinMat)
    head.add(skull)

    // 发光眼睛
    const eyeGeo = new THREE.SphereGeometry(0.09, 16, 16)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat)
    leftEye.position.set(-0.3, 0.1, 0.8)
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat)
    rightEye.position.set(0.3, 0.1, 0.8)
    head.add(leftEye, rightEye)

    // 嘴巴（扁球，说话时纵向缩放模拟开合）
    const mouthGeo = new THREE.SphereGeometry(0.24, 24, 16)
    mouthGeo.scale(1, 0.26, 0.4)
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    const mouth = new THREE.Mesh(mouthGeo, mouthMat)
    mouth.position.set(0, -0.32, 0.74)
    head.add(mouth)

    // 面罩光环
    const visorMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65 })
    const visor = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.022, 16, 48), visorMat)
    visor.position.set(0, 0.1, 0.76)
    head.add(visor)
    root.add(head)

    // ---- 身体 ----
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0f1e2e, roughness: 0.7, metalness: 0.35 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 1.02, 1.35, 48), bodyMat)
    body.position.y = -1.55
    root.add(body)

    // 胸口能量核心
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), coreMat)
    core.position.set(0, -1.15, 0.78)
    root.add(core)

    // 领口光环
    const collarMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 })
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.03, 16, 48), collarMat)
    collar.rotation.x = Math.PI / 2
    collar.position.y = -0.88
    root.add(collar)

    // 全息底环（双层）
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.6 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.02, 16, 64), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = -2.0
    root.add(ring)

    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.012, 16, 64), ring2Mat)
    ring2.rotation.x = Math.PI / 2
    ring2.position.y = -2.02
    root.add(ring2)

    // ---- 环绕粒子 ----
    const count = 140
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 1.55 + Math.random() * 0.9
      pos[i * 3] = Math.cos(a) * r
      pos[i * 3 + 1] = (Math.random() - 0.5) * 3.1
      pos[i * 3 + 2] = Math.sin(a) * r
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.032, transparent: true, opacity: 0.7 }),
    )
    root.add(particles)

    // ---- 动画循环 ----
    const clock = new THREE.Clock()
    let raf = 0
    const render = (): void => {
      const t = clock.getElapsedTime()
      const c = moodColor()
      eyeMat.color.copy(c)
      mouthMat.color.copy(c)
      visorMat.color.copy(c)
      coreMat.color.copy(c)
      collarMat.color.copy(c)
      ringMat.color.copy(c)
      ring2Mat.color.copy(c)

      // 待机浮动 / 转头
      root.position.y = Math.sin(t * 0.9) * 0.07
      root.rotation.y = Math.sin(t * 0.32) * 0.22
      head.rotation.y = Math.sin(t * 0.5) * 0.16
      head.rotation.x = Math.sin(t * 0.4) * 0.05

      // 眨眼
      const blink = Math.sin(t * 1.6) > 0.97 ? 0.12 : 1
      leftEye.scale.y = blink
      rightEye.scale.y = blink

      // 说话：嘴巴开合 + 底环/核心脉冲
      if (speakingRef.current) {
        mouth.scale.y = 1 + Math.abs(Math.sin(t * 9)) * 2.2
        ring.scale.setScalar(1 + Math.sin(t * 6) * 0.08)
        core.scale.setScalar(1 + Math.sin(t * 6) * 0.25)
      } else {
        mouth.scale.y = 1
        ring.scale.setScalar(1)
        core.scale.setScalar(1)
      }

      ring.rotation.z = t * 0.4
      ring2.rotation.z = -t * 0.3
      particles.rotation.y = t * 0.15

      renderer.render(scene, camera)
      raf = requestAnimationFrame(render)
    }
    render()

    // 自适应容器宽度（正方形渲染）
    const setSize = (): void => {
      const w = mount.clientWidth || size
      const s = Math.max(120, Math.floor(w))
      renderer.setSize(s, s)
      camera.aspect = 1
      camera.updateProjectionMatrix()
    }
    setSize()
    const ro = new ResizeObserver(setSize)
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else if (mat) mat.dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [size])

  return (
    <div
      ref={mountRef}
      style={{ width: '100%', maxWidth: size, aspectRatio: '1', margin: '0 auto', ...style }}
    />
  )
}
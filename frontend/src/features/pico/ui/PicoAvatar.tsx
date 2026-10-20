import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { PicoEmotion } from '../core/types'
import { PicoController, deformVertex, faceVertex, type PicoReaction } from '../animation/controller'
import { paintFace } from '../animation/face'
import { subscribePicoFrame, wakePicoFrames } from '../animation/scheduler'

interface PicoAvatarProps {
  emotion: PicoEmotion
  size?: number
  /** Lab controls; ordinary product instances retain quiet autonomous movement. */
  rotation?: number
  speed?: number
  reducedMotion?: boolean
  reaction?: PicoReaction
}

function curvedDisplay(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 40, 16)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < position.count; i++) position.setXYZ(i, ...faceVertex(uv.getX(i), uv.getY(i)))
  geometry.computeVertexNormals()
  return geometry
}

function deform(geometry: THREE.BufferGeometry, source: Float32Array, pose: { squash: number; wobble: number }, normals = true) {
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    positions.setXYZ(i, ...deformVertex(source[i * 3], source[i * 3 + 1], source[i * 3 + 2], pose))
  }
  positions.needsUpdate = true
  if (normals) geometry.computeVertexNormals()
}

export default function PicoAvatar({ emotion, size = 84, rotation = 0, speed = 1, reducedMotion, reaction }: PicoAvatarProps) {
  const mountRef = useRef<HTMLSpanElement>(null)
  const stateRef = useRef({ emotion, rotation, speed, reducedMotion, reaction })
  stateRef.current = { emotion, rotation, speed, reducedMotion, reaction }
  const invalidateRef = useRef<() => void>(() => {})
  useEffect(() => { invalidateRef.current() }, [emotion, rotation, speed, reducedMotion, reaction])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20)
    camera.position.set(0, 0.12, 4.45)
    camera.lookAt(0, -0.015, 0)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      mount.dataset.picoRenderer = 'unavailable'
      const fallback = document.createElement('span')
      fallback.textContent = '三维形象不可用'
      fallback.style.cssText = 'font-size:10px;line-height:1.5;color:var(--muted);text-align:center;align-self:center'
      fallback.setAttribute('role', 'status')
      mount.appendChild(fallback)
      return () => fallback.remove()
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, size <= 84 ? 1.75 : 2))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    renderer.domElement.setAttribute('aria-hidden', 'true')
    mount.appendChild(renderer.domElement)
    mount.dataset.picoRenderer = 'webgl'
    scene.add(new THREE.HemisphereLight(0xfff9ed, 0x737976, 2.4))
    const key = new THREE.DirectionalLight(0xfff8eb, 3.1)
    key.position.set(-3, 4, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xe1e4df, 1.6)
    rim.position.set(3, 1, -2)
    scene.add(rim)

    const actor = new THREE.Group()
    scene.add(actor)
    const bodyGeometry = new THREE.SphereGeometry(1, size < 60 ? 32 : 48, size < 60 ? 24 : 32)
    const bodySource = new Float32Array(bodyGeometry.getAttribute('position').array)
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe9e5dc, metalness: 0.12, roughness: 0.29, clearcoat: 0.65, clearcoatRoughness: 0.23,
    })
    actor.add(new THREE.Mesh(bodyGeometry, bodyMaterial))

    const faceCanvas = document.createElement('canvas')
    faceCanvas.width = 512
    faceCanvas.height = 256
    const faceContext = faceCanvas.getContext('2d')
    const texture = new THREE.CanvasTexture(faceCanvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    const faceGeometry = curvedDisplay()
    const faceSource = new Float32Array(faceGeometry.getAttribute('position').array)
    const faceMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.FrontSide })
    actor.add(new THREE.Mesh(faceGeometry, faceMaterial))

    // Small side hardware makes true rotation legible without neon effects.
    const accentGeometry = new THREE.SphereGeometry(0.075, 16, 12)
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xc13d46, roughness: 0.45, metalness: 0.2 })
    const accent = new THREE.Mesh(accentGeometry, accentMaterial)
    accent.position.set(0.73, 0.43, 0.57)
    actor.add(accent)
    const seamGeometry = new THREE.TorusGeometry(0.997, 0.008, 6, 80)
    const seamMaterial = new THREE.MeshStandardMaterial({ color: 0xb6b1a7, roughness: 0.7 })
    const seam = new THREE.Mesh(seamGeometry, seamMaterial)
    seam.rotation.x = Math.PI / 2
    seam.position.y = -0.035
    actor.add(seam)

    const disposeAssets = () => {
      bodyGeometry.dispose(); bodyMaterial.dispose()
      faceGeometry.dispose(); faceMaterial.dispose(); texture.dispose()
      accentGeometry.dispose(); accentMaterial.dispose()
      seamGeometry.dispose(); seamMaterial.dispose()
    }

    const controller = new PicoController(21 + size)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = true
    let lost = false
    let last = 0
    let rendered = 0
    let frameCount = 0
    let needsFrame = true
    let previousEmotion = emotion
    let previousReaction = 0
    const onMedia = () => { needsFrame = true; last = 0; wakePicoFrames() }
    invalidateRef.current = onMedia
    const onAttention = () => { controller.react('attention'); onMedia() }
    mount.addEventListener('pointerenter', onAttention)
    media.addEventListener('change', onMedia)
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true
      if (visible) { last = 0; needsFrame = true; wakePicoFrames() }
    }) : null
    observer?.observe(mount)
    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      // Clear the old GPU caches while commands are safely ignored by the lost
      // context. CPU mesh/texture data remains usable and is uploaded on restore.
      // Otherwise obsolete dispose listeners retain pre-loss WebGL handles.
      disposeAssets()
      mount.dataset.picoRenderer = 'context-lost'
      renderer.domElement.style.opacity = '0.25'
      mount.title = '三维绘图上下文暂不可用'
    }
    const onRestored = () => {
      lost = false
      last = 0
      needsFrame = true
      texture.needsUpdate = true
      bodyMaterial.needsUpdate = faceMaterial.needsUpdate = true
      accentMaterial.needsUpdate = seamMaterial.needsUpdate = true
      mount.dataset.picoRenderer = 'webgl'
      renderer.domElement.style.opacity = '1'
      mount.removeAttribute('title')
      wakePicoFrames()
    }
    renderer.domElement.addEventListener('webglcontextlost', onLost)
    renderer.domElement.addEventListener('webglcontextrestored', onRestored)
    const unsubscribe = subscribePicoFrame({
      active: () => visible && !lost && (needsFrame || (!(stateRef.current.reducedMotion ?? media.matches) && stateRef.current.speed > 0)),
      render: (now) => {
        const state = stateRef.current
        const reduced = state.reducedMotion ?? media.matches
        if (previousEmotion !== state.emotion) { needsFrame = true; previousEmotion = state.emotion }
        const interval = reduced ? 180 : size <= 84 ? 33 : 1000 / 45
        if (!needsFrame && now - rendered < interval) return
        needsFrame = false
        const dt = last ? Math.min(0.064, (now - last) / 1000) : 1 / 60
        last = now
        rendered = now
        controller.setEmotion(state.emotion)
        if (state.reaction && state.reaction.id !== previousReaction) {
          previousReaction = state.reaction.id
          controller.react(state.reaction.kind)
        }
        const pose = controller.step(dt * Math.max(0, Math.min(2, state.speed)), reduced)
        actor.position.y = pose.bob
        actor.position.z = pose.lean
        actor.rotation.set(pose.pitch, pose.yaw + state.rotation, pose.roll)
        deform(bodyGeometry, bodySource, pose)
        deform(faceGeometry, faceSource, pose, false)
        accent.position.set(...deformVertex(0.73, 0.43, 0.57, pose))
        seam.scale.set(1 / Math.sqrt(1 + pose.squash), 1 / Math.sqrt(1 + pose.squash), 1)
        seam.position.y = -0.035 * (1 + pose.squash)
        if (faceContext) {
          paintFace(faceContext, pose, size <= 60)
          texture.needsUpdate = true
        }
        renderer.render(scene, camera)
        if (import.meta.env.DEV) {
          mount.dataset.picoFrames = String(++frameCount)
          mount.dataset.picoYaw = actor.rotation.y.toFixed(4)
          mount.dataset.picoPitch = pose.pitch.toFixed(4)
          mount.dataset.picoRoll = pose.roll.toFixed(4)
          mount.dataset.picoGazeX = pose.gazeX.toFixed(4)
          mount.dataset.picoGazeY = pose.gazeY.toFixed(4)
          mount.dataset.picoLean = pose.lean.toFixed(4)
          mount.dataset.picoAction = pose.action
          mount.dataset.picoActionProgress = pose.actionProgress.toFixed(4)
          mount.dataset.picoReaction = String(previousReaction)
          mount.dataset.picoBlink = pose.blink.toFixed(4)
          mount.dataset.picoSquash = pose.squash.toFixed(4)
          mount.dataset.picoVertices = String(bodyGeometry.getAttribute('position').count)
          mount.dataset.picoReduced = String(reduced)
          mount.dataset.picoTime = pose.time.toFixed(4)
        }
      },
    })
    return () => {
      unsubscribe()
      observer?.disconnect()
      invalidateRef.current = () => {}
      mount.removeEventListener('pointerenter', onAttention)
      media.removeEventListener('change', onMedia)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored)
      disposeAssets()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [size])

  return <span
    ref={mountRef}
    className={`pico-avatar pico-avatar--${emotion}`}
    style={{ width: size, height: size, animation: 'none', filter: 'drop-shadow(0 6px 10px rgba(35, 30, 24, .12))' }}
    role="img"
    aria-label={`Pico 三维球形助手 · ${emotion}`}
  />
}

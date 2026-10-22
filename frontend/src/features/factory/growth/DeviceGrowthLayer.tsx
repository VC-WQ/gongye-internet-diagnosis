import { useLayoutEffect, useRef, useState } from 'react'
import { AmbientLight, ACESFilmicToneMapping, DirectionalLight, OrthographicCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { useUiPreferences } from '../../../services/uiPrefs'
import { STATUS_META, TYPE_LABEL } from '../../../components/BusinessUI'
import { useDeviceVisual } from './DeviceVisualProvider'
import DeviceIcon from './DeviceIcon'
import { buildDeviceModel } from './models'
import type { DeviceModel } from './modelTypes'
import { GrowthMotion } from './growthMotion'
import { configureDeviceCamera, projectDevicePoint } from './projection'
import { modelKindForType } from './visualConfig'
import type { DeviceAnchor, ScenePointerInput } from './DeviceSceneBridge'
import type { GrowthLayerProps } from './DeviceGrowthHost'
import './deviceGrowth.css'

type Display = { id: string | null; phase: string; unavailable: boolean }
type Runtime = { refresh: () => void; rotate: (delta: number) => void }

/** The only Factory renderer. Business selection is read from Workspace props. */
export default function DeviceGrowthLayer(props: GrowthLayerProps) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const hit = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null)
  const runtime = useRef<Runtime | null>(null)
  const visual = useDeviceVisual()
  const { theme, reducedMotion } = useUiPreferences()
  const latest = useRef({ ...props, visual, theme, reducedMotion })
  latest.current = { ...props, visual, theme, reducedMotion }
  const [display, setDisplay] = useState<Display>({ id: null, phase: 'idle', unavailable: false })

  useLayoutEffect(() => {
    const hostNode = host.current, drawing = canvas.current
    if (!hostNode || !drawing) return
    const element: HTMLDivElement = hostNode
    const { bridge } = latest.current
    const motion = new GrowthMotion()
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas: drawing, alpha: true, antialias: true, powerPreference: 'low-power' })
      renderer.outputColorSpace = SRGBColorSpace
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.1
      renderer.setClearColor(0x000000, 0)
      drawing.dataset.factoryRenderer = 'webgl'
    } catch {
      setDisplay({ id: null, phase: 'unavailable', unavailable: true })
      element.dataset.growthPhase = 'unavailable'
      return
    }
    const scene = new Scene(), camera = new OrthographicCamera()
    scene.add(new AmbientLight(0xffffff, 2.25))
    const light = new DirectionalLight(0xffffff, 3)
    light.position.set(-3, 5, 4); scene.add(light)
    let disposed = false, available = true, frame = 0, last = 0, width = 0, height = 0, pixelRatio = 0
    let model: DeviceModel | null = null, modelKey = '', blendedId: string | null = null, angle = 0
    let renders = 0, builds = 0, lastDrawKey = '', visibleDisplay: Display = { id: null, phase: 'idle', unavailable: false }
    let interactive = false
    let rotation: { id: number; x: number; y: number; pointerType: string } | null = null

    const publish = (value: Display) => {
      if (value.id !== visibleDisplay.id || value.phase !== visibleDisplay.phase || value.unavailable !== visibleDisplay.unavailable) {
        visibleDisplay = value; setDisplay(value)
      }
      element.dataset.growthPhase = value.phase
      element.dataset.visualDevice = value.id ?? ''
      element.dataset.requestedDevice = latest.current.selected ?? ''
      element.dataset.growthProgress = motion.p.toFixed(5)
      element.dataset.growthVelocity = motion.v.toFixed(5)
    }
    const releaseRotation = () => {
      const pointer = rotation; rotation = null
      if (pointer && hit.current?.hasPointerCapture(pointer.id)) hit.current.releasePointerCapture(pointer.id)
    }
    const dropModel = () => {
      if (!disposed && (hit.current?.contains(document.activeElement) || card.current?.contains(document.activeElement))) {
        element.closest('.factory-scene')?.querySelector<SVGSVGElement>('.factory-svg')?.focus({ preventScroll:true })
      }
      if (blendedId) bridge.blend(blendedId, 0)
      blendedId = null
      if (model) { scene.remove(model.root); model.dispose(); model = null; modelKey = ''; lastDrawKey = '' }
      element.dataset.growthGeometries = String(renderer.info.memory.geometries)
      element.dataset.growthTextures = String(renderer.info.memory.textures)
      interactive = false; releaseRotation()
      if (hit.current) {
        Object.assign(hit.current.style, { pointerEvents:'none',width:'0px',height:'0px' })
        hit.current.tabIndex = -1; hit.current.setAttribute('aria-hidden','true')
      }
      if (card.current) {
        card.current.style.pointerEvents = 'none'; card.current.style.opacity = '0'
        card.current.setAttribute('aria-hidden','true')
        card.current.querySelectorAll('button').forEach(button => { button.tabIndex = -1 })
      }
    }
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; element.dataset.growthRaf = 'idle' }
    const fail = () => {
      available = false; stop(); dropModel(); motion.reset()
      renderer.clear(); publish({ id: null, phase: 'unavailable', unavailable: true })
    }
    const positionUI = (anchor: DeviceAnchor) => {
      const points = []
      for (const x of [-1.15, 1.15]) for (const z of [-1.15, 1.15]) for (const y of [0, 1.7]) {
        points.push(projectDevicePoint(anchor.matrix, { x, y, z }))
      }
      const left = Math.max(0, Math.min(...points.map(p => p.x))), top = Math.max(0, Math.min(...points.map(p => p.y)))
      if (hit.current) {
        Object.assign(hit.current.style, { left: `${left}px`, top: `${top}px`,
          width: `${Math.max(0, Math.min(anchor.width, Math.max(...points.map(p => p.x))) - left)}px`,
          height: `${Math.max(0, Math.min(anchor.height, Math.max(...points.map(p => p.y))) - top)}px`,
          pointerEvents: interactive ? 'auto' : 'none' })
        hit.current.tabIndex = interactive ? 0 : -1
        hit.current.setAttribute('aria-hidden', interactive ? 'false' : 'true')
      }
      if (card.current) {
        const center = projectDevicePoint(anchor.matrix, { x: 0, y: 0, z: 0 })
        const bottom = projectDevicePoint(anchor.matrix, { x: 1, y: 0, z: 1 })
        const t = Math.max(0, Math.min(1, (motion.p - .75) / .25)), opacity = t*t*(3-2*t)
        const cardWidth = card.current.offsetWidth, cardHeight = card.current.offsetHeight
        Object.assign(card.current.style, { left: `${Math.max(8, Math.min(anchor.width-cardWidth-8, center.x-cardWidth/2))}px`,
          top: `${Math.max(8, Math.min(anchor.height-cardHeight-8, bottom.y+12))}px`, opacity: String(opacity),
          transform: `translate3d(0,${(1-opacity)*6}px,0)`, pointerEvents: interactive ? 'auto' : 'none' })
        card.current.setAttribute('aria-hidden', interactive ? 'false' : 'true')
        card.current.querySelectorAll('button').forEach(button => { button.tabIndex = interactive ? 0 : -1 })
      }
    }
    const schedule = () => {
      if (!frame && available && !disposed && !document.hidden) {
        element.dataset.growthRaf = 'active'
        frame = requestAnimationFrame(now => { frame = 0; update(now) })
      }
    }
    function update(now: number) {
      if (disposed || !available || document.hidden) return
      cancelAnimationFrame(frame); frame = 0
      const p = latest.current
      const requested = p.devices.find(d => d.id === p.selected && p.visibleIds.has(d.id))
      const desired = requested && bridge.read(requested.id) ? requested.id : null
      motion.request(desired, p.reducedMotion)
      if (motion.activeId && !bridge.read(motion.activeId)) {
        dropModel(); motion.reset(); motion.request(desired, p.reducedMotion)
      }
      const elapsed = last ? Math.max(0, Math.min(50, now-last)) : 0
      last = now
      const moving = motion.tick(elapsed, p.reducedMotion)
      const device = p.devices.find(d => d.id === motion.activeId)
      const anchor = device ? bridge.read(device.id) : null
      if (!device || !anchor) {
        dropModel(); renderer.clear(); stop()
        publish({ id: null, phase: 'idle', unavailable: false })
        return
      }
      const appearance = p.visual.get(device), kind = modelKindForType(device.device_type)
      const key = `${device.id}:${kind}:${p.theme}`
      try {
        if (!model || modelKey !== key) {
          const oldId = blendedId
          dropModel()
          if (oldId !== device.id) angle = 0
          model = buildDeviceModel(kind, appearance.accentColor, p.theme === 'light')
          builds++; element.dataset.growthModelBuilds = String(builds)
          modelKey = key; scene.add(model.root)
        }
        model.setAccent(appearance.accentColor)
        model.applyProgress(motion.p); model.turntable.rotation.y = angle
        blendedId = device.id; bridge.blend(device.id, motion.p)
        if (width !== anchor.width || height !== anchor.height || pixelRatio !== Math.min(devicePixelRatio, 1.5)) {
          width = anchor.width; height = anchor.height; pixelRatio = Math.min(devicePixelRatio, 1.5)
          renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false)
        }
        if (!configureDeviceCamera(camera, anchor.matrix, width, height)) { fail(); return }
        const drawKey = JSON.stringify([modelKey,appearance.accentColor,anchor.matrix,width,height,pixelRatio,motion.p,angle])
        if (drawKey !== lastDrawKey) { renderer.render(scene, camera); renders++; lastDrawKey = drawKey }
        if (import.meta.env.DEV) {
          // Read-only geometry evidence; no business data or mutable renderer
          // handles are exposed to the application or production bundle.
          const corners = [[0,-35],[103,19],[0,74],[-103,19]].map(([x,y]) => {
            const point = new Vector3((x/51.5+(y-19.5)/27.25)/2,0,(-x/51.5+(y-19.5)/27.25)/2).project(camera)
            return { x:(point.x+1)*width/2,y:(1-point.y)*height/2 }
          })
          Object.assign(element, { __growthQA: { matrix:anchor.matrix,width,height,corners,stats:model.stats,sequence:anchor.sequence } })
        }
        interactive = motion.phase === 'expanded' && !anchor.pointerBusy
        if (!interactive) releaseRotation()
        positionUI(anchor)
        element.dataset.growthRenders = String(renders)
        element.dataset.growthGeometries = String(renderer.info.memory.geometries)
        element.dataset.growthTextures = String(renderer.info.memory.textures)
        element.dataset.growthTriangles = String(renderer.info.render.triangles)
        element.dataset.growthAngle = angle.toFixed(4)
        publish({ id: device.id, phase: motion.phase, unavailable: false })
        // SVG motion paints synchronously before the browser presents. Only
        // self-drive while SVG is still, avoiding two competing frame loops.
        if (moving && !anchor.sceneMoving) schedule()
        else { element.dataset.growthRaf = 'idle'; if (!moving) last = 0 }
      } catch (error) { console.error('Device growth unavailable', error); fail() }
    }
    const refresh = () => { if (!available) return; update(performance.now()) }
    const rotate = (delta: number) => {
      if (!interactive || !model) return
      angle = Math.max(-.95, Math.min(.95, angle+delta)); refresh()
    }
    runtime.current = { refresh, rotate }
    const off = bridge.subscribe(update)
    const visibility = () => {
      stop(); releaseRotation()
      if (!document.hidden) refresh()
      else element.dataset.growthRaf = 'hidden'
    }
    const lost = (event: Event) => { event.preventDefault(); fail() }
    const restored = () => { if (disposed) return; available = true; last = 0; refresh() }
    const windowChanged = () => refresh()
    let resolution: MediaQueryList | undefined
    let resolutionFrame = 0
    const resolutionChanged = () => {
      cancelAnimationFrame(resolutionFrame)
      // Some engines deliver the media event before the new DPR is observable.
      // Sample the committed environment on one bounded frame, then re-arm.
      resolutionFrame = requestAnimationFrame(() => {
        resolutionFrame = 0
        if (!disposed) { observeResolution(); refresh() }
      })
    }
    const observeResolution = () => {
      resolution?.removeEventListener('change',resolutionChanged)
      cancelAnimationFrame(resolutionFrame)
      resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
      resolution.addEventListener('change',resolutionChanged)
    }
    observeResolution()
    document.addEventListener('visibilitychange', visibility)
    drawing.addEventListener('webglcontextlost', lost)
    drawing.addEventListener('webglcontextrestored', restored)
    window.addEventListener('resize', windowChanged)
    const hitElement = hit.current
    const offTransfer = bridge.registerRotationTransfer(event => {
      if (!rotation || event.pointerType !== 'touch' || rotation.pointerType !== 'touch' || event.pointerId === rotation.id) return null
      const first: ScenePointerInput = { pointerId:rotation.id,clientX:rotation.x,clientY:rotation.y,
        button:0,pointerType:rotation.pointerType,target:hitElement }
      rotation = null
      return first
    })
    const down = (event: PointerEvent) => {
      if (!interactive || event.button !== 0) return
      event.preventDefault(); event.stopPropagation()
      if (rotation && event.pointerId !== rotation.id && event.pointerType === 'touch') {
        // Transfer both fingers to the original SVG pinch controller, rather
        // than reimplementing its camera or swallowing the second pointer.
        bridge.pointerDown(event)
        return
      }
      rotation = { id:event.pointerId,x:event.clientX,y:event.clientY,pointerType:event.pointerType }
      hitElement?.setPointerCapture(event.pointerId)
    }
    const drag = (event: PointerEvent) => {
      if (!rotation || rotation.id !== event.pointerId) return
      const delta = event.clientX-rotation.x
      rotation.x = event.clientX; rotation.y = event.clientY; rotate(delta*.009)
    }
    const up = (event: PointerEvent) => { if (rotation?.id === event.pointerId) releaseRotation() }
    const wheel = (event: WheelEvent) => bridge.wheel(event)
    const gesture = (event: Event) => bridge.gesture(event)
    hitElement?.addEventListener('pointerdown', down)
    hitElement?.addEventListener('pointermove', drag)
    for (const name of ['pointerup','pointercancel','lostpointercapture']) hitElement?.addEventListener(name, up as EventListener)
    hitElement?.addEventListener('wheel', wheel, { passive:false })
    for (const name of ['gesturestart','gesturechange','gestureend']) hitElement?.addEventListener(name, gesture, { passive:false })
    return () => {
      disposed = true; stop(); off(); offTransfer(); dropModel(); runtime.current = null
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('resize', windowChanged)
      resolution?.removeEventListener('change',resolutionChanged)
      cancelAnimationFrame(resolutionFrame)
      drawing.removeEventListener('webglcontextlost', lost); drawing.removeEventListener('webglcontextrestored', restored)
      hitElement?.removeEventListener('pointerdown', down); hitElement?.removeEventListener('pointermove', drag)
      for (const name of ['pointerup','pointercancel','lostpointercapture']) hitElement?.removeEventListener(name, up as EventListener)
      hitElement?.removeEventListener('wheel', wheel)
      for (const name of ['gesturestart','gesturechange','gestureend']) hitElement?.removeEventListener(name, gesture)
      scene.clear(); renderer.dispose(); delete drawing.dataset.factoryRenderer
      // StrictMode immediately reuses a connected canvas; only lose a context
      // when its actual DOM owner has gone away, never on device clicks.
      queueMicrotask(() => { if (!drawing.isConnected) renderer.forceContextLoss() })
    }
  }, [])

  const visibleKey = [...props.visibleIds].sort().join('|')
  useLayoutEffect(() => runtime.current?.refresh(), [props.devices, props.selected, visibleKey, visual, theme, reducedMotion, display.id, display.phase])
  const device = props.devices.find(d => d.id === display.id)
  const appearance = device ? visual.get(device) : null
  return <div ref={host} className="device-growth" data-growth-layer onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.bridge.clear() }
  }}>
    <canvas ref={canvas} className="device-growth__canvas" aria-hidden />
    <div ref={hit} className="device-growth__hit" role="group" tabIndex={-1}
      aria-label={`${device?.name ?? '设备'}三维示意，拖动或左右键旋转，Esc 收起`}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); runtime.current?.rotate(event.key === 'ArrowLeft' ? -.15 : .15) }
      }} />
    {device && appearance && <div ref={card} className="device-growth__card" aria-label="三维设备资料">
      <div className="device-growth__identity"><DeviceIcon icon={appearance.iconKey} color={appearance.accentColor} /><strong title={appearance.displayAlias ?? device.name}>{appearance.displayAlias ?? device.name}</strong>
        <span className="device-growth__status" style={{ color:STATUS_META[device.status]?.hex }}>{STATUS_META[device.status]?.label ?? device.status}</span></div>
      <small>{device.id} · {TYPE_LABEL[device.device_type] ?? device.device_type} · {modelKindForType(device.device_type) === 'generic' ? '通用示意' : '三维示意'}</small>
      {appearance.displayAlias && <small>真实名称：{device.name}</small>}
      <div className="device-growth__actions"><span><button type="button" aria-label="向左旋转设备" onClick={() => runtime.current?.rotate(-.2)}>↶</button><button type="button" aria-label="向右旋转设备" onClick={() => runtime.current?.rotate(.2)}>↷</button></span>
        <button className="device-growth__close" type="button" onClick={() => props.bridge.clear()}>收起三维</button></div>
    </div>}
    {display.unavailable && props.selected && <p className="device-growth__unavailable" role="status">三维暂不可用，设备平面视图与业务入口仍可使用。</p>}
  </div>
}

import { DeviceIconPaths } from '../features/factory/growth/DeviceIcon'
import { DeviceSceneBridge, type DeviceAnchor, type ScenePointerInput } from '../features/factory/growth/DeviceSceneBridge'
import { relativeAffine } from '../features/factory/growth/projection'
import DeviceGrowthHost from '../features/factory/growth/DeviceGrowthHost'
import { useDeviceVisual } from '../features/factory/growth/DeviceVisualProvider'
import { CameraFocusProgress } from '../features/factory/growth/focusMotion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Space } from 'antd'
import { boundCamera, zoomAt, pinchCamera, type Camera } from '../services/sceneCamera'
import { createSlots, distance, focusCamera, inverse, outside, planScene, pointerIntent,
  sampleItem, sceneView, settleScene, transform, type Geometry, type Matrix, type Point, type SceneItem, type ScenePlan } from '../services/sceneLayout'
import type { Device } from '../services/api'
import { STATUS_META } from './BusinessUI'
import './sceneMotion.css'

function Machine({ type }: { type: string }) {
  return (
    <g className="machine-shape">
      <path
        d="M-67 20 5-18 70 17 0 55Z"
        fill="var(--machine-base)"
        stroke="var(--line)"
        strokeWidth="1.2"
      />
      <path d="M-67 20v9L0 65v-10Z" fill="var(--machine-side)" />
      <path d="M0 55v10L70 27V17Z" fill="var(--machine-front)" />
      {type === 'compressor' ? (
        <>
          <path d="M-47-31 1-56 48-31v55L1 49-47 24Z" fill="var(--machine-front)" />
          <path d="M-47-31 1-6 48-31 1-56Z" fill="var(--machine-top)" />
          <path d="M1-6v55l47-25v-55Z" fill="var(--machine-side)" />
          <path
            d="M-37-13-10 1M-37-4-10 10M-37 5-10 19M12 2 35-10M12 12 35 0M12 22 35 10"
            stroke="var(--machine-detail)"
            strokeWidth="4"
          />
          <path
            d="M-29-41v-20l30-16 28 15v20"
            fill="none"
            stroke="var(--machine-metal)"
            strokeWidth="5"
          />
        </>
      ) : (
        <>
          <path d="M-46-19-4-41 46-14v35L4 44-46 17Z" fill="var(--machine-front)" />
          <ellipse
            cx="-25"
            cy="-3"
            rx="26"
            ry="31"
            fill="var(--machine-top)"
            transform="rotate(-25 -25 -3)"
          />
          <ellipse
            cx="-25"
            cy="-3"
            rx="17"
            ry="22"
            fill="var(--machine-side)"
            transform="rotate(-25 -25 -3)"
          />
          <path
            d="M-5-35 42-10M-4-25 44 0M-3-14 44 10"
            stroke="var(--machine-metal)"
            strokeWidth="3"
          />
          <path d="M4 15v26M19 8v25M33 1v24" stroke="var(--machine-detail)" strokeWidth="4" />
          {type === 'pump' ? (
            <>
              <path
                d="M-31-16v-29L-9-57 6-49v27"
                fill="var(--machine-metal)"
                stroke="var(--machine-top)"
              />
              <ellipse
                cx="-25"
                cy="-3"
                rx="9"
                ry="12"
                fill="var(--machine-metal)"
                transform="rotate(-25 -25 -3)"
              />
            </>
          ) : (
            <>
              <path d="M-18-37v-14L4-63 24-52v14L3-26Z" fill="var(--machine-top)" />
              <path d="M-45 11-63 20" stroke="var(--machine-metal)" strokeWidth="8" />
            </>
          )}
        </>
      )}
    </g>
  )
}
type Sprite = SceneItem & { device: Device; phase: string; generation: number }
type SpriteView = { id: string; device: Device; visible: boolean }
type Pointer = { start: Point; last: Point; device?: string; moved: number; touch: boolean }
type Controller = {
  sync: () => void; measure: () => void; reset: () => void; zoom: (factor: number) => void; place: (id:string) => void
  notify: () => void; select: (id: string) => void; focus: (id?:string) => void; pan: (x: number, y: number) => void
  down: (e: ScenePointerInput) => void
  drag: (e: ScenePointerInput) => void
  up: (e: ScenePointerInput, cancelled?: boolean) => void
}
const HOME: Camera = { x: 0, y: 0, zoom: 1 }
const matrixValue = (m: DOMMatrix): Matrix => ({ a:m.a, b:m.b, c:m.c, d:m.d, e:m.e, f:m.f })

export default function FactoryScene({ devices, visibleIds, selected, onSelect, onClear }: {
  devices: Device[]; visibleIds: ReadonlySet<string>; selected?: string
  onSelect: (id: string) => void; onClear?: () => void
}) {
  const bridge = useMemo(() => new DeviceSceneBridge(), [])
  const visual = useDeviceVisual()
  const root = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), cameraGroup = useRef<SVGGElement>(null)
  const nodes = useRef(new Map<string, SVGGElement>())
  const nodeCallbacks = useRef(new Map<string, (node: SVGGElement | null) => void>())
  const deviceRef = (id: string) => {
    let callback = nodeCallbacks.current.get(id)
    if (!callback) {
      callback = node => { if (node) { nodes.current.set(id,node); controller.current?.place(id) } else nodes.current.delete(id) }
      nodeCallbacks.current.set(id,callback)
    }
    return callback
  }
  const props = useRef({ devices, visibleIds, selected, onSelect, onClear })
  props.current = { devices, visibleIds, selected, onSelect, onClear }
  const controller = useRef<Controller>()
  const [sprites, setSprites] = useState<SpriteView[]>([])
  const [view, setView] = useState({ columns: 4, width: 900, height: 660, x: 0, y: 0 })
  const viewRef = useRef(view); viewRef.current = view
  const [zoomLabel, setZoomLabel] = useState(100)
  const visibleKey = [...visibleIds].sort().join('|')
  useLayoutEffect(() => controller.current?.sync(), [devices, visibleKey])
  useLayoutEffect(() => controller.current?.measure(), [view])
  useLayoutEffect(() => controller.current?.focus(selected), [selected])
  // Ref attachment is a commit-wide transaction. Never publish a partially
  // reattached map to the overlay while React is committing sibling devices.
  useLayoutEffect(() => {
    const known = new Set(devices.map(device => device.id))
    for (const id of nodeCallbacks.current.keys()) if (!known.has(id)) nodeCallbacks.current.delete(id)
    controller.current?.notify()
  })

  useEffect(() => {
    const element = svg.current, group = cameraGroup.current, host = root.current
    if (!element || !group || !host) return
    // StrictMode replays effects without detaching the existing DOM refs.
    for (const node of element.querySelectorAll<SVGGElement>('g[data-device]')) nodes.current.set(node.dataset.device!,node)
    const model = new Map<string, Sprite>(), pointers = new Map<number, Pointer>()
    let camera = { ...HOME }, targetCamera = { ...HOME }, cameraVelocity = { x:0, y:0, zoom:0 }
    let rootMatrix: Matrix | null = null, geometry: Geometry | null = null
    let frame = 0, lastTime = 0, generation = 0, initialized = false, disposed = false
    let plan: ScenePlan | null = null, basis = new Map<string, SceneItem>(), planStart = 0
    let hiddenAt: number | null = document.hidden ? performance.now() : null
    let geometryPauseAt: number | null = null
    let multiple = false, nativeGesture = false, gestureScale = 1
    let cameraDirty = false, lastProjection = 0, catalogKey = '', filterKey = ''
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    let reduced = media.matches
    const clock = () => geometryPauseAt ?? hiddenAt ?? performance.now()
    const pauseGeometry = () => {
      if(geometryPauseAt===null)geometryPauseAt=clock()
      host.dataset.sceneState='waiting-geometry';host.dataset.sceneRaf='idle'
      notify()
    }
    const resumeGeometry = () => {
      if(geometryPauseAt!==null){planStart+=(hiddenAt??performance.now())-geometryPauseAt;geometryPauseAt=null}
    }
    let lastFocused: string | undefined
    const focusProgress = new CameraFocusProgress()
    let anchorSequence = 0
    const anchorCache = new Map<string, DeviceAnchor | null>()
    // Filtering removes business/DOM identity immediately. A bounded visual
    // lease lets an already-grown model finish its collapse on the same focus
    // seam, even after its outgoing SVG node leaves the clip and unmounts.
    const retiringAnchors = new Map<string, Point>()
    const notify = () => {
      anchorSequence++; anchorCache.clear()
      const focusFrame = focusProgress.sample(camera,targetCamera,cameraVelocity,!activeCamera(),clock())
      bridge.setFocus(focusFrame)
      host.dataset.focusEpoch = String(focusFrame.epoch)
      host.dataset.focusDevice = focusFrame.deviceId ?? ''
      host.dataset.focusProgress = String(focusFrame.progress)
      host.dataset.focusSettled = String(focusFrame.settled)
      if (focusFrame.settledAt !== undefined) host.dataset.focusSettledAt = String(focusFrame.settledAt)
      bridge.afterPaint(clock())
    }
    const render = () => {
      if (disposed) return
      // React receives immutable business/semantic DTOs, never mutable motion objects.
      const next=[...model.values()].filter(s=>s.present).map(s=>({id:s.id,device:{...s.device},visible:s.visible}))
      setSprites(previous=>previous.length===next.length&&previous.every((s,i)=>s.id===next[i].id&&s.visible===next[i].visible&&
        JSON.stringify(s.device)===JSON.stringify(next[i].device))?previous:next)
    }
    const cameraTransform = () => `translate(${450+camera.x} ${330+camera.y}) scale(${camera.zoom}) translate(-450 -330)`
    const updateGeometry = () => {
      const raw=element.getScreenCTM()
      rootMatrix=raw&&inverse(matrixValue(raw))?matrixValue(raw):null
      if (!rootMatrix) { geometry=null; return }
      const r = element.getBoundingClientRect(), s = rootMatrix
      const x = 450*(1-camera.zoom)+camera.x, y = 330*(1-camera.zoom)+camera.y
      geometry = { matrix: { a:s.a*camera.zoom, b:s.b*camera.zoom, c:s.c*camera.zoom, d:s.d*camera.zoom,
        e:s.a*x+s.c*y+s.e, f:s.b*x+s.d*y+s.f },
        rect: { left:r.left, right:r.right, top:r.top, bottom:r.bottom } }
    }
    const place = (id:string) => {
        const sprite=model.get(id)
        if(!sprite)return
        const node = nodes.current.get(sprite.id)
        if (!node) return
        node.setAttribute('transform', `translate(${sprite.current.x} ${sprite.current.y})`)
        node.dataset.sceneOwner='controller'
        node.dataset.scenePosition = `${sprite.current.x.toFixed(3)},${sprite.current.y.toFixed(3)}`
        node.dataset.sceneVelocity = `${sprite.velocity.x.toFixed(2)},${sprite.velocity.y.toFixed(2)}`
        node.dataset.scenePhase = sprite.visible ? sprite.phase : 'exit'
        node.dataset.sceneTarget = `${sprite.target.x.toFixed(2)},${sprite.target.y.toFixed(2)}`
        node.dataset.sceneGeneration = String(sprite.generation)
        if (sprite.edge) node.dataset.sceneExitEdge = sprite.edge
    }
    const paint = () => {
      group.setAttribute('transform', cameraTransform())
      element.dataset.camera = `${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.zoom.toFixed(3)}`
      for (const id of model.keys())place(id)
      notify()
    }
    const advance = (time: number) => {
      if (!plan) return
      let changed = false
      for (const sprite of model.values()) {
        const original = basis.get(sprite.id)
        if (!original) continue
        const sampled = sampleItem(original, plan, time-planStart)
        if (sprite.present !== sampled.present || sprite.phase !== sampled.phase) changed = true
        sprite.current = sampled.point; sprite.velocity = sampled.velocity
        sprite.present = sampled.present; sprite.phase = sampled.phase
        if (sprite.present && !sprite.visible && geometry && outside(sprite.current, geometry)) {
          // Once entirely out of the *current* clip, it need not finish an offscreen detour.
          sprite.present = false
          sprite.velocity={x:0,y:0}
          basis.set(sprite.id,{...original,current:{...sprite.current},velocity:{x:0,y:0},present:false})
          plan.reservations=plan.reservations.filter(r=>r.id!==sprite.id)
          plan.duration=Math.max(0,...plan.reservations.map(r=>r.end))
          changed = true
        }
      }
      if (changed) render()
    }
    const snap = () => {
      const wanted = [...model.values()].filter(s=>s.visible)
      for (const settled of settleScene([...model.values()],createSlots(wanted.length,viewRef.current.columns))) {
        Object.assign(model.get(settled.id)!,settled,{phase:'idle'})
      }
      plan=null; basis.clear(); render(); paint()
      host.dataset.sceneDiagnostics=reduced?'reduced-motion':'initial-layout'
      host.dataset.sceneDuration='0'
      host.dataset.sceneState='idle';host.dataset.sceneRaf='idle'
    }
    const replan = (cameraOnly=false) => {
      if (!geometry) { pauseGeometry(); return }
      resumeGeometry();advance(clock())
      generation++
      if (!initialized || reduced) { initialized=true; snap(); return }
      const items=[...model.values()].map(s=>({ id:s.id, current:{...s.current}, velocity:{...s.velocity}, target:{...s.target},
        present:s.present, visible:s.visible, edge:s.edge }))
      const fixed=cameraOnly?new Map(items.filter(s=>s.visible).map(s=>[s.id,s.target])):undefined
      plan=planScene(items, createSlots(items.filter(s=>s.visible).length,viewRef.current.columns),geometry,fixed)
      basis=new Map(items.map(s=>[s.id,s])); planStart=clock()
      host.dataset.sceneDiagnostics=plan.diagnostics.join(';')||'direct'
      host.dataset.sceneDuration=String(Math.round(plan.duration))
      host.dataset.sceneGeneration=String(generation)
      for (const sprite of model.values()) {
        sprite.generation=generation
        sprite.target=plan.targets.get(sprite.id)??sprite.target
        const outgoing=plan.reservations.find(r=>r.id===sprite.id && (r.kind==='exit'||r.kind==='enter'))
        if (outgoing?.edge) sprite.edge=outgoing.edge
      }
      render(); paint(); ensureFrame()
    }
    const sync = () => {
      const p=props.current, nextCatalog=p.devices.map(d=>d.id).join('|'), nextFilter=[...p.visibleIds].sort().join('|')
      const changed=nextCatalog!==catalogKey||nextFilter!==filterKey
      // Sample BEFORE overwriting desired flags; old completion never owns the new generation.
      advance(clock())
      const known=new Set(p.devices.map(d=>d.id))
      for (const sprite of model.values()) {
        const visible=known.has(sprite.id)&&p.visibleIds.has(sprite.id)
        if (sprite.visible&&!visible&&nodes.current.get(sprite.id)?.classList.contains('is-growth'))
          retiringAnchors.set(sprite.id,{...sprite.current})
        sprite.visible=visible
      }
      const slots=createSlots(p.devices.length,viewRef.current.columns)
      p.devices.forEach((device,index)=>{
        const existing=model.get(device.id)
        if (existing) { existing.device=device; existing.visible=p.visibleIds.has(device.id) }
        else model.set(device.id,{id:device.id,device,current:slots[index],target:slots[index],velocity:{x:0,y:0},
          present:false,visible:p.visibleIds.has(device.id),phase:'idle',generation})
      })
      for (const [id,sprite] of model) if (!known.has(id)&&!sprite.present) model.delete(id)
      const active=document.activeElement?.closest('[data-device]')?.getAttribute('data-device')
      if (active&&!model.get(active)?.visible) element.focus({preventScroll:true})
      catalogKey=nextCatalog; filterKey=nextFilter
      host.dataset.sceneVisible=[...p.visibleIds].filter(id=>known.has(id)).sort().join(',')
      host.dataset.sceneCatalog=String(p.devices.length)
      if (changed||!initialized) replan()
      else { render(); paint() }
    }
    const measure = () => {
      if (disposed) return
      const r=element.getBoundingClientRect()
      const next=sceneView(r.width,r.height), v=viewRef.current
      if (r.width<=0||r.height<=0) { rootMatrix=null; geometry=null; pauseGeometry();return }
      if (next.columns!==v.columns||Math.abs(next.height-v.height)>1||next.width!==v.width) {
        rootMatrix=null; geometry=null; pauseGeometry();setView(next); return
      }
      // Both CTMs must be valid. A missing/singular CTM never substitutes client units.
      const raw=element.getScreenCTM(), cameraCTM=group.getScreenCTM()
      rootMatrix=raw&&inverse(matrixValue(raw))&&cameraCTM&&inverse(matrixValue(cameraCTM))?matrixValue(raw):null
      updateGeometry()
      host.dataset.sceneColumns=String(v.columns)
      host.dataset.sceneGeometry=geometry?'valid':'waiting'
      replan()
      focus(props.current.selected)
    }
    const activeCamera = () => (['x','y','zoom'] as const).some(k=>Math.abs(targetCamera[k]-camera[k])>(k==='zoom'?.0004:.08)||Math.abs(cameraVelocity[k])>.02)
    const animate = (time: number) => {
      frame=0
      if (disposed||hiddenAt!==null) return
      const dt=Math.min((time-(lastTime||time-16))/1000,.032); lastTime=time
      if (activeCamera()) {
        for (const k of ['x','y','zoom'] as const) {
          cameraVelocity[k]+=((targetCamera[k]-camera[k])*190-cameraVelocity[k]*27)*dt
          camera[k]+=cameraVelocity[k]*dt
        }
        if (!activeCamera()) { camera={...targetCamera}; cameraVelocity={x:0,y:0,zoom:0}; setZoomLabel(Math.round(camera.zoom*100)) }
        cameraDirty=true
      }
      updateGeometry()
      if(!geometry){pauseGeometry();lastTime=0;return}
      resumeGeometry();advance(time)
      // Camera sampling is cheap; constrained planning is throttled and only for active presence.
      if (cameraDirty&&geometry&&time-lastProjection>160&&[...model.values()].some(s=>s.present&&!s.visible||!s.present&&s.visible)) {
        cameraDirty=false; lastProjection=time; replan(true)
      }
      paint()
      const moving=activeCamera()||Boolean(plan&&time-planStart<plan.duration)
      if (moving) ensureFrame()
      else {
        lastTime=0; host.dataset.sceneState=geometry?'idle':'waiting-geometry'; host.dataset.sceneRaf='idle'
        plan=null; basis.clear()
        const known=new Set(props.current.devices.map(d=>d.id))
        for (const [id,sprite] of model) if (!known.has(id)&&!sprite.present) model.delete(id)
      }
    }
    function ensureFrame() {
      if (!frame&&!disposed&&hiddenAt===null&&host) { host.dataset.sceneState='moving'; host.dataset.sceneRaf='active'; frame=requestAnimationFrame(animate) }
    }
    const move = (value: Camera, immediate=false, focusId: string | null=props.current.selected??null) => {
      targetCamera=boundCamera(value)
      focusProgress.begin(focusId,camera,targetCamera,cameraVelocity,clock())
      if (immediate||reduced) {
        camera={...targetCamera}; cameraVelocity={x:0,y:0,zoom:0}; paint(); updateGeometry()
      }
      cameraDirty=true; setZoomLabel(Math.round(targetCamera.zoom*100)); notify();ensureFrame()
    }
    const local = (x:number,y:number) => { const inv=inverse(rootMatrix); return inv?transform({x,y},inv):null }
    const zoom = (factor:number,anchor={x:450,y:330})=>move(zoomAt(targetCamera,factor,anchor))
    const reset = ()=>move(HOME,false,null)
    const focus = (id?:string)=>{
      if(!id){
        lastFocused=undefined
        if (focusProgress.read().deviceId !== null) {
          // URL/back/context cancellation follows the same reversible return
          // as Esc and the canvas clear button, including a settled camera.
          reset()
        }
        return
      }
      if(!geometry||!initialized)return
      const sprite=model.get(id)
      if (!sprite?.visible||!props.current.devices.some(d=>d.id===id)) return
      // The selected business identity already changed. Only its visual focus
      // waits for the cold lazy renderer; failure releases the original 2D path.
      if (bridge.readiness === 'cold') return
      const v=viewRef.current
      const signature=`${id}:${v.columns}:${v.x}:${v.y}:${v.width}:${v.height}:${sprite.target.x}:${sprite.target.y}`
      if(lastFocused===signature)return
      lastFocused=signature
      host.dataset.sceneFocusRequests=String(Number(host.dataset.sceneFocusRequests??0)+1)
      move(focusCamera(sprite.target,{left:v.x,right:v.x+v.width,top:v.y,bottom:v.y+v.height},v.columns<4?1.1:1.3))
    }
    const select = (id:string)=>{
      if(!model.get(id)?.visible||!props.current.devices.some(d=>d.id===id))return
      props.current.onSelect(id)
    }
    const hit = (target: EventTarget|null) => {
      const id=target instanceof Element?target.closest('[data-device]')?.getAttribute('data-device'):undefined
      return id&&model.get(id)?.visible?id:undefined
    }
    const release = (e:ScenePointerInput,cancelled=false) => {
      const p=pointers.get(e.pointerId)
      if (!p) return
      const end=document.elementFromPoint(e.clientX,e.clientY)
      const intent=pointerIntent(p.device,hit(end),Math.max(p.moved,distance(p.start,{x:e.clientX,y:e.clientY})),p.touch,multiple,cancelled)
      pointers.delete(e.pointerId)
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId)
      if (!pointers.size) {
        if (intent==='select'&&p.device) select(p.device)
        else if (intent==='clear'&&end&&element.contains(end)) { reset(); props.current.onClear?.() }
        multiple=false
      }
      notify()
    }
    controller.current={sync,measure,reset,zoom,select,focus,place,notify,pan:(x,y)=>move({...targetCamera,x:targetCamera.x+x,y:targetCamera.y+y}),
      down:e=>{
        if (e.button!==0) return
        const transferred = bridge.transferRotationToScene(e)
        if (transferred) controller.current?.down(transferred)
        if (!pointers.size) multiple=false
        else multiple=true
        const p={x:e.clientX,y:e.clientY}
        pointers.set(e.pointerId,{start:p,last:p,device:hit(e.target),moved:0,touch:e.pointerType==='touch'})
        element.setPointerCapture(e.pointerId)
        notify()
      },
      drag:e=>{
        const p=pointers.get(e.pointerId)
        if (!p) return
        const next={x:e.clientX,y:e.clientY}, old=p.last
        p.moved=Math.max(p.moved,distance(p.start,next)); p.last=next
        if (nativeGesture) return
        updateGeometry()
        const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)?.[1]
        const a=local(old.x,old.y),b=local(next.x,next.y)
        if (!a||!b) return
        if (other) { const anchor=local(other.last.x,other.last.y); if (anchor) move(pinchCamera(targetCamera,[a,anchor],[b,anchor]),true) }
        else if (p.moved>(p.touch?7:3)) move({...targetCamera,x:targetCamera.x+b.x-a.x,y:targetCamera.y+b.y-a.y},true)
      },up:release}
    const wheel = (e:WheelEvent)=>{
      updateGeometry()
      const p=local(e.clientX,e.clientY)
      if (!p) return
      e.preventDefault()
      const unit=e.deltaMode===1?16:e.deltaMode===2?element.clientHeight:1
      if (e.ctrlKey||e.metaKey) zoom(Math.exp(-e.deltaY*unit*.008),p)
      else { const q=local(e.clientX-e.deltaX*unit,e.clientY-e.deltaY*unit); if (q) move({...targetCamera,x:targetCamera.x+q.x-p.x,y:targetCamera.y+q.y-p.y}) }
    }
    const gesture = (event:Event)=>{
      event.preventDefault()
      updateGeometry()
      const e=event as Event&{scale:number;clientX:number;clientY:number}
      if (event.type==='gesturestart') { nativeGesture=true;multiple=true;gestureScale=e.scale||1 }
      else if (event.type==='gestureend') nativeGesture=false
      else { const anchor=local(e.clientX,e.clientY); if (anchor&&Number.isFinite(e.scale)&&e.scale>0) zoom(e.scale/gestureScale,anchor); gestureScale=e.scale||1 }
    }
    const disconnectBridge = bridge.connect({
      read: id => {
        if (anchorCache.has(id)) return anchorCache.get(id) ?? null
        const node = nodes.current.get(id), item = model.get(id)
        let result: DeviceAnchor | null = null
        const retiring = retiringAnchors.get(id)
        if (retiring || node?.isConnected && item?.visible && item.present && props.current.visibleIds.has(id)) {
          // Keep the outgoing world position, never a frozen screen transform:
          // both the existing exit path and the returning camera remain live.
          if (retiring && item) Object.assign(retiring,item.current)
          const basis = retiring ? group.getScreenCTM() : node!.getScreenCTM()
          const raw = basis && retiring ? { ...matrixValue(basis),
            e:basis.a*retiring.x+basis.c*retiring.y+basis.e,
            f:basis.b*retiring.x+basis.d*retiring.y+basis.f } : basis
          const source = element.getScreenCTM(), box = element.viewBox.baseVal
          const style = getComputedStyle(element), width = parseFloat(style.width), height = parseFloat(style.height)
          const matrix = raw && source ? relativeAffine(matrixValue(source), raw,
            { x:box.x, y:box.y, width:box.width, height:box.height }, width, height) : null
          if (matrix) {
            const x = matrix.c * 19.5 + matrix.e, y = matrix.d * 19.5 + matrix.f
            const pad = Math.hypot(matrix.a,matrix.b) * 180
            if (retiring || x > -pad && x < width+pad && y > -pad && y < height+pad) result = { deviceId:id,matrix,width,height,
              sequence:anchorSequence,sceneMoving:activeCamera() || Boolean(plan && clock()-planStart < plan.duration),pointerBusy:pointers.size > 0,
              focus:focusProgress.read() }
          }
        }
        anchorCache.set(id,result)
        return result
      },
      blend: (id,p) => {
        if (p <= 0) retiringAnchors.delete(id)
        const node = nodes.current.get(id)
        if (!node) return
        if (p <= 0) {
          node.classList.remove('is-growth')
          for (const key of ['machine','platform','shadow','caption']) node.style.removeProperty(`--growth-${key}-opacity`)
          return
        }
        const mix = (a:number,b:number) => { const t = Math.max(0,Math.min(1,(p-a)/(b-a)));return t*t*(3-2*t) }
        node.classList.add('is-growth')
        node.style.setProperty('--growth-machine-opacity', String(1-mix(.12,.55)))
        node.style.setProperty('--growth-platform-opacity', String(1-mix(0,.28)))
        node.style.setProperty('--growth-shadow-opacity', String(.6*(1-mix(.12,.55))))
        node.style.setProperty('--growth-caption-opacity', String(1-mix(.75,1)))
      },
      wheel, gesture, pointerDown: event => controller.current?.down(event),
      clear: () => { reset(); props.current.onClear?.(); element.focus({preventScroll:true}) },
      rendererReady: () => focus(props.current.selected),
    })
    const motionChanged=()=>{ reduced=media.matches; if (reduced) { camera={...targetCamera};cameraVelocity={x:0,y:0,zoom:0};replan();ensureFrame() } }
    const visibility=()=>{
      if (document.hidden) { hiddenAt=performance.now();advance(clock());paint();cancelAnimationFrame(frame);frame=0;lastTime=0;host.dataset.sceneRaf='hidden' }
      else { if (hiddenAt!==null&&geometryPauseAt===null) planStart+=performance.now()-hiddenAt;hiddenAt=null;lastTime=0;measure();ensureFrame() }
    }
    element.addEventListener('wheel',wheel,{passive:false})
    for (const name of ['gesturestart','gesturechange','gestureend']) element.addEventListener(name,gesture,{passive:false})
    document.addEventListener('visibilitychange',visibility);media.addEventListener('change',motionChanged)
    const resize=new ResizeObserver(measure);resize.observe(element)
    sync();measure();paint()
    if(props.current.selected)focus(props.current.selected)
    return ()=>{
      disconnectBridge();disposed=true;cancelAnimationFrame(frame);controller.current=undefined
      resize.disconnect();document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',motionChanged)
      element.removeEventListener('wheel',wheel)
      for (const name of ['gesturestart','gesturechange','gestureend']) element.removeEventListener(name,gesture)
      for (const id of pointers.keys()) if (element.hasPointerCapture(id)) element.releasePointerCapture(id)
      pointers.clear();nodes.current.clear();model.clear();basis.clear();retiringAnchors.clear();plan=null
    }
  },[])

  return (
    <div ref={root} className="factory-scene factory-scene--continuous" data-scene-qa="v2.5"
      data-route-preparing={!sprites.length&&visibleIds.size>0?'true':undefined}>
      <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} className="factory-svg"
        aria-label="设备交互场景，可拖动或双指平移、捏合缩放，方向键平移，Home复位，Esc取消选择" tabIndex={0}
        onKeyDown={e=>{
          if (e.key==='Escape') { e.preventDefault();controller.current?.reset();onClear?.();return }
          if ((e.target as Element).closest('[data-device]')) return
          const steps:Record<string,[number,number]>={ArrowLeft:[45,0],ArrowRight:[-45,0],ArrowUp:[0,45],ArrowDown:[0,-45]}
          if (steps[e.key]) { e.preventDefault();controller.current?.pan(...steps[e.key]) }
          if (e.key==='Home') { e.preventDefault();controller.current?.reset() }
          if (e.key==='+'||e.key==='=') { e.preventDefault();controller.current?.zoom(1.15) }
          if (e.key==='-') { e.preventDefault();controller.current?.zoom(1/1.15) }
        }}
        onPointerDown={e=>controller.current?.down(e)} onPointerMove={e=>controller.current?.drag(e)}
        onPointerUp={e=>controller.current?.up(e)} onPointerCancel={e=>controller.current?.up(e,true)}
        onLostPointerCapture={e=>controller.current?.up(e,true)}>
        <defs>
          <pattern id="factory-grid" width="48" height="48" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .5 -1 .5 450 90)">
            <path d="M48 0H0V48" fill="none" stroke="var(--scene-grid)" strokeWidth="1" />
          </pattern>
          <radialGradient id="factory-ground"><stop stopColor="var(--scene-ground)" stopOpacity=".65" /><stop offset="1" stopColor="var(--surface)" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="450" cy="365" rx="425" ry="280" fill="url(#factory-ground)" />
        <g ref={cameraGroup}>
          <path d="M30 300 450 80 870 300 450 540Z" fill="url(#factory-grid)" stroke="var(--line)" />
          <path d="M30 300v20l420 220 420-220v-20M450 540v20" fill="none" stroke="var(--line)" />
          {sprites.map(sprite=>{
            const device=sprite.device,chosen=device.id===selected,color=STATUS_META[device.status]?.hex??'#7d8997'
            return <g key={device.id} ref={deviceRef(device.id)}
              data-device={device.id} role="button" tabIndex={sprite.visible?0:-1}
              aria-label={`${device.name}，${STATUS_META[device.status]?.label??device.status}`} aria-pressed={chosen} aria-hidden={!sprite.visible||undefined}
              pointerEvents={sprite.visible?'auto':'none'} className={`factory-node ${chosen?'is-selected':''}`}
              onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();controller.current?.select(device.id)}}}>
              <title>{device.name} · {device.id}</title>
              <path className="node-platform" d="M-103 19 0-35 103 19 0 74Z" />
              <ellipse cx="0" cy="28" rx="64" ry="17" fill="var(--machine-shadow)" opacity=".6" />
              <Machine type={device.device_type} />
              <path className="node-edge" d="M-103 19 0 74 103 19" fill="none" strokeWidth="2" />
              <g className="node-caption" transform="translate(0 111)">
                <rect className="node-label" x="-95" y="-16" width="190" height="40" rx="0" />
                <circle cx="-78" cy="3" r="4" fill={color} />
                <svg x="-65" y="-7" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={visual.get(device).accentColor} strokeWidth="1.5" aria-hidden><DeviceIconPaths icon={visual.get(device).iconKey} /></svg>
                <rect x="91" y="-15" width="3" height="38" fill={visual.get(device).accentColor} aria-hidden />
                <text x="-40" y="8" fill="var(--text)" fontSize="15" fontWeight="500">{Array.from(visual.get(device).displayAlias ?? device.name).length>8?Array.from(visual.get(device).displayAlias ?? device.name).slice(0,7).join('')+'…':(visual.get(device).displayAlias ?? device.name)}</text>
              </g>
            </g>
          })}
        </g>
      </svg>
      <DeviceGrowthHost bridge={bridge} devices={devices} visibleIds={visibleIds} selected={selected} />
      {!sprites.length&&(!devices.length||!visibleIds.size)&&<div className="scene-empty"><Empty description={devices.length?'没有符合筛选的设备':'暂无设备'} /></div>}
      <div className="scene-controls">
        <span className="scene-hint">{visibleIds.size} 台设备 · 拖动平移 · 捏合缩放</span>
        <Space.Compact>
          <Button aria-label="缩小场景" onClick={()=>controller.current?.zoom(1/1.15)}>−</Button>
          <Button aria-label="重置视角" onClick={()=>controller.current?.reset()}>{zoomLabel}%</Button>
          <Button aria-label="放大场景" onClick={()=>controller.current?.zoom(1.15)}>＋</Button>
        </Space.Compact>
      </div>
    </div>
  )
}

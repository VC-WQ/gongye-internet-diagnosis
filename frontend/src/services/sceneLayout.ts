/** Pure scene geometry and bounded reservation planning. No DOM, timers or React. */
import { MOTION } from '../motion/tokens'
export type Point = { x: number; y: number }
export type Rect = { left: number; right: number; top: number; bottom: number }
export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type Geometry = { matrix: Matrix; rect: Rect }
export const MACHINE_BOX: Rect = { left: -103, right: 103, top: -77, bottom: 151 }
export const SCENE_GAP = 14
const EPS = .001
const zero = (): Point => ({ x: 0, y: 0 })
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export function transform(p: Point, m: Matrix): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}
export function inverse(m: Matrix | null | undefined): Matrix | null {
  if (!m || ![m.a,m.b,m.c,m.d,m.e,m.f].every(Number.isFinite)) return null
  const det = m.a * m.d - m.b * m.c
  if (Math.abs(det) < 1e-10) return null
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det }
}
export function projectBox(p: Point, m: Matrix, box = MACHINE_BOX): Rect {
  const corners = [
    { x: p.x + box.left, y: p.y + box.top }, { x: p.x + box.right, y: p.y + box.top },
    { x: p.x + box.left, y: p.y + box.bottom }, { x: p.x + box.right, y: p.y + box.bottom },
  ].map(q => transform(q, m))
  return { left: Math.min(...corners.map(q => q.x)), right: Math.max(...corners.map(q => q.x)),
    top: Math.min(...corners.map(q => q.y)), bottom: Math.max(...corners.map(q => q.y)) }
}
export function outside(p: Point, geometry: Geometry): boolean {
  const b = projectBox(p, geometry.matrix), r = geometry.rect
  return b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom
}
/** Distances and margins are client pixels; only the result is converted to world. */
export function edgeCandidates(p: Point, geometry: Geometry | null, preferred?: Edge): { edge: Edge; point: Point; travel: number }[] {
  const inv = geometry && inverse(geometry.matrix)
  if (!geometry || !inv || geometry.rect.right <= geometry.rect.left || geometry.rect.bottom <= geometry.rect.top) return []
  const q = transform(p, geometry.matrix), b = projectBox(p, geometry.matrix), r = geometry.rect
  const pad = 6
  const candidates: { edge: Edge; point: Point }[] = [
    { edge: 'left', point: { x: r.left - (b.right - q.x) - pad, y: q.y } },
    { edge: 'right', point: { x: r.right + (q.x - b.left) + pad, y: q.y } },
    { edge: 'top', point: { x: q.x, y: r.top - (b.bottom - q.y) - pad } },
    { edge: 'bottom', point: { x: q.x, y: r.bottom + (q.y - b.top) + pad } },
  ]
  return candidates.map(c => ({ edge: c.edge, point: transform(c.point, inv), travel: distance(q, c.point) }))
    .sort((a, b) => (a.edge === preferred ? -1 : b.edge === preferred ? 1 : a.travel - b.travel))
}
export function sceneView(width: number, height: number) {
  const columns = width < 430 ? 2 : width < 600 ? 3 : 4
  const w = columns === 2 ? 500 : columns === 3 ? 720 : 900
  const h = columns < 4 ? Math.max(320, w * Math.max(1, height) / Math.max(1, width)) : 660
  return { columns, width: w, height: h, x: 450 - w / 2, y: 330 - h / 2 }
}
export function createSlots(count: number, maxColumns = 4): Point[] {
  if (count <= 0) return []
  const columns = Math.min(maxColumns, count), rows = Math.ceil(count / columns)
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns), rowCount = Math.min(columns, count - row * columns)
    return { x: 450 + (i % columns - (rowCount - 1) / 2) * 224, y: 293 + (row - (rows - 1) / 2) * 246 }
  })
}
/** Exact distance assignment for <=12 nodes, with deterministic stable tie breaking.
 * This solves only the assignment cost, NOT the complete collision/path problem. */
export function assignSlots(items: { id: string; current: Point; target?: Point }[], slots: Point[]): Map<string, Point> {
  const result = new Map<string, Point>()
  if (!items.length) return result
  if (items.length > 12) {
    const free = [...slots]
    for (const item of items) {
      free.sort((a, b) => distance(item.current, a) - distance(item.current, b))
      const p = free.shift()
      if (p) result.set(item.id, p)
    }
    return result
  }
  const n = items.length, size = 1 << n
  const costs = new Float64Array(size).fill(Infinity), chosen = new Int16Array(size).fill(-1)
  costs[0] = 0
  for (let mask = 0; mask < size; mask++) {
    let row = 0
    for (let bits = mask; bits; bits &= bits - 1) row++
    if (row >= n) continue
    for (let col = 0; col < n; col++) if (!(mask & (1 << col))) {
      const item = items[row], slot = slots[col]
      const cost = costs[mask] + distance(item.current, slot) +
        (item.target && distance(item.target, slot) < 1 ? 0 : 12) + col * 1e-7
      const next = mask | (1 << col)
      if (cost < costs[next]) { costs[next] = cost; chosen[next] = col }
    }
  }
  let mask = size - 1
  for (let row = n - 1; row >= 0; row--) {
    const col = chosen[mask]
    result.set(items[row].id, slots[col])
    mask ^= 1 << col
  }
  const objective = () => {
    let cost = 0
    for (let i = 0; i < n; i++) {
      const a = items[i], goal = result.get(a.id)!
      cost += distance(a.current, goal) + (distance(a.current, goal) > 1 ? 16 : 0)
      if (a.target && distance(a.target, goal) > 1) cost += 12
      for (let j = 0; j < i; j++) {
        const b = items[j], other = result.get(b.id)!
        // A bounded proxy for simultaneous body occupancy and order changes.
        if (sweptOverlap(a.current, goal, b.current, other)) cost += 1800
        if ((a.current.x-b.current.x)*(goal.x-other.x) < -1) cost += 60
        if ((a.current.y-b.current.y)*(goal.y-other.y) < -1) cost += 60
      }
    }
    return cost
  }
  for (let pass = 0; pass < 3; pass++) {
    let best = objective(), improved = false
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
      const a = items[i].id, b = items[j].id, pa = result.get(a)!, pb = result.get(b)!
      result.set(a,pb); result.set(b,pa)
      const cost = objective()
      if (cost + EPS < best) { best=cost; improved=true }
      else { result.set(a,pa); result.set(b,pb) }
    }
    if (!improved) break
  }
  return result
}
export function focusCamera(p: Point, view: Rect, preferred = 1.3) {
  let camera = { x: 0, y: 0, zoom: .6 }
  for (let zoom = preferred; zoom >= .599; zoom -= .05) {
    camera = { zoom: Math.max(.6, zoom), x: Math.max(-560, Math.min(560, (450-p.x)*zoom)),
      y: Math.max(-420, Math.min(420, (330-p.y-37)*zoom)) }
    const b = projectBox(p, { a: camera.zoom, b: 0, c: 0, d: camera.zoom,
      e: 450*(1-camera.zoom)+camera.x, f: 330*(1-camera.zoom)+camera.y })
    if (b.left >= view.left+10 && b.right <= view.right-10 && b.top >= view.top+10 && b.bottom <= view.bottom-10) break
  }
  return camera
}
function segmentRect(a: Point, b: Point, r: Rect): boolean {
  let lo = 0, hi = 1
  for (const [p, delta, min, max] of [[a.x, b.x - a.x, r.left, r.right], [a.y, b.y - a.y, r.top, r.bottom]]) {
    if (Math.abs(delta) < 1e-10) { if (p <= min + EPS || p >= max - EPS) return false }
    else {
      const t0 = (min - p) / delta, t1 = (max - p) / delta
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1))
      if (lo >= hi - 1e-8) return false
    }
  }
  return hi > EPS && lo < 1 - EPS
}
export function boxesOverlap(a: Point, b: Point, gap = SCENE_GAP): boolean {
  return Math.abs(a.x - b.x) < 206 + gap - EPS && Math.abs(a.y - b.y) < 228 + gap - EPS
}
export function sweptOverlap(a0: Point, a1: Point, b0: Point, b1: Point, gap = SCENE_GAP): boolean {
  return segmentRect({ x: a0.x - b0.x, y: a0.y - b0.y }, { x: a1.x - b1.x, y: a1.y - b1.y },
    { left: -206 - gap, right: 206 + gap, top: -228 - gap, bottom: 228 + gap }) || boxesOverlap(a0, b0, gap) || boxesOverlap(a1, b1, gap)
}
/** A small visibility graph around Minkowski-expanded stationary machines. */
export function safePath(from: Point, to: Point, obstacles: Point[]): Point[] | null {
  if (obstacles.some(p => boxesOverlap(to, p))) return null
  const rects = obstacles.map(p => ({ left: p.x - 220, right: p.x + 220, top: p.y - 242, bottom: p.y + 242 }))
  const clear = (a: Point, b: Point) => !rects.some(r => segmentRect(a, b, r))
  if (clear(from, to)) return [from, to]
  const nodes = [from, to, ...rects.flatMap(r => [
    { x: r.left - .1, y: r.top - .1 }, { x: r.right + .1, y: r.top - .1 },
    { x: r.left - .1, y: r.bottom + .1 }, { x: r.right + .1, y: r.bottom + .1 },
  ]).filter(p => !rects.some(r => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom))]
  const costs = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = new Set<number>()
  costs[0] = 0
  for (let step = 0; step < nodes.length; step++) {
    let next = -1
    for (let i = 0; i < nodes.length; i++) if (!done.has(i) && (next < 0 || costs[i] < costs[next])) next = i
    if (next < 0 || !Number.isFinite(costs[next])) break
    if (next === 1) {
      const path: Point[] = []
      for (let i = 1; i >= 0; i = prev[i]) { path.unshift(nodes[i]); if (!i) break }
      return path.length <= 10 ? path : null
    }
    done.add(next)
    for (let i = 0; i < nodes.length; i++) if (!done.has(i) && clear(nodes[next], nodes[i])) {
      const cost = costs[next] + distance(nodes[next], nodes[i])
      if (cost < costs[i]) { costs[i] = cost; prev[i] = next }
    }
  }
  return null
}
export type Leg = { from: Point; to: Point; velocity: Point; duration: number }
export type Route = { legs: Leg[]; duration: number }
export function createRoute(points: Point[], initialVelocity = zero()): Route {
  const legs = points.slice(1).map((to, i) => {
    const from = points[i], length = distance(from, to), travel = MOTION.sceneReflow
    const duration = Math.max(travel.min, Math.min(travel.max, length / travel.worldUnitsPerMs))
    let velocity = i === 0 ? { ...initialVelocity } : zero()
    const speed = Math.hypot(velocity.x, velocity.y), limit = length / (duration / 1000) * 1.5
    if (speed > limit) velocity = { x: velocity.x * limit / speed, y: velocity.y * limit / speed }
    return { from, to, velocity, duration }
  })
  return { legs, duration: legs.reduce((sum, l) => sum + l.duration, 0) }
}
export function sampleRoute(route: Route, elapsed: number): { point: Point; velocity: Point; done: boolean } {
  if (!route.legs.length) return { point: zero(), velocity: zero(), done: true }
  let t = Math.max(0, elapsed)
  for (const leg of route.legs) {
    if (t <= leg.duration) {
      const u = t / leg.duration, u2 = u * u, u3 = u2 * u, seconds = leg.duration / 1000
      const point = zero(), velocity = zero()
      for (const k of ['x', 'y'] as const) {
        point[k] = (2*u3-3*u2+1)*leg.from[k] + (u3-2*u2+u)*seconds*leg.velocity[k] + (-2*u3+3*u2)*leg.to[k]
        velocity[k] = ((6*u2-6*u)*leg.from[k] + (3*u2-4*u+1)*seconds*leg.velocity[k] + (-6*u2+6*u)*leg.to[k]) / seconds
      }
      return { point, velocity, done: false }
    }
    t -= leg.duration
  }
  return { point: { ...route.legs[route.legs.length - 1].to }, velocity: zero(), done: true }
}
export type SceneItem = { id: string; current: Point; velocity: Point; target: Point; present: boolean; visible: boolean; edge?: Edge }
export type Reservation = { id: string; route: Route; start: number; end: number; kind: 'move' | 'enter' | 'exit' | 'park'; edge?: Edge }
export type ScenePlan = { reservations: Reservation[]; targets: Map<string, Point>; diagnostics: string[]; duration: number }
/** Reduced motion commits the same business set without retaining visual exits. */
export function settleScene(items: SceneItem[], slots: Point[]): SceneItem[] {
  const targets=assignSlots(items.filter(i=>i.visible),slots)
  return items.map(item=>({ ...item, current:{...(targets.get(item.id)??item.current)}, target:{...(targets.get(item.id)??item.target)},
    velocity:zero(), present:item.visible }))
}
function at(item: SceneItem, plans: Reservation[], t: number): Point | null {
  let p = item.present ? item.current : null
  for (const plan of plans) if (plan.id === item.id) {
    if (t < plan.start) break
    if (t >= plan.end) p = plan.kind === 'exit' ? null : plan.route.legs[plan.route.legs.length-1].to
    else p = sampleRoute(plan.route, t - plan.start).point
  }
  return p
}
function temporalSafe(item: SceneItem, route: Route, start: number, items: SceneItem[], plans: Reservation[]): boolean {
  const end = Math.max(start + route.duration, ...plans.map(p => p.end), 0)
  for (let t = start; t < end; t += 20) {
    const next = Math.min(end, t + 20), a0 = sampleRoute(route, t-start).point, a1 = sampleRoute(route, next-start).point
    for (const other of items) if (other.id !== item.id) {
      // A reservation can disappear in this interval; inspect the occupied instant
      // just before its end rather than treating the whole final interval as empty.
      const b0 = at(other, plans, t), b1 = at(other, plans, next-1e-6)
      if (b0 && b1 && sweptOverlap(a0, a1, b0, b1)) return false
      if (b0 && !b1) {
        const finish=plans.filter(p=>p.id===other.id&&p.kind==='exit'&&p.end>t&&p.end<=next).map(p=>p.end)[0]
        if (finish!==undefined) {
          const before=at(other,plans,finish-1e-6)
          if (before&&sweptOverlap(a0,sampleRoute(route,finish-start).point,b0,before)) return false
        }
      }
    }
  }
  return true
}
/** Finite local planner: stationary obstacle routes + full-body temporal reservations.
 * Failed compaction retains the previous legal seat; diagnostics expose each fallback. */
export function planScene(items: SceneItem[], slots: Point[], geometry: Geometry | null, fixedTargets?: Map<string, Point>, allowStableFallback=true): ScenePlan {
  const reservations: Reservation[] = [], diagnostics: string[] = []
  const visible = items.filter(i => i.visible)
  const targets = fixedTargets && visible.every(i=>fixedTargets.has(i.id)) ? new Map(fixedTargets) : assignSlots(visible, slots)
  if (!geometry || !inverse(geometry.matrix)) return { reservations, targets, diagnostics: ['waiting-geometry'], duration: 0 }
  const positions = new Map(items.filter(i => i.present).map(i => [i.id, i.current]))
  const pending = [...items.filter(i => !i.visible && i.present), ...visible]
  const parked = new Set<string>()
  let total = 0, budget = items.length * 4 + 4
  const add = (item: SceneItem, points: Point[], kind: Reservation['kind'], edge?: Edge) => {
    let route = createRoute(points, reservations.some(r => r.id === item.id) ? zero() : item.velocity)
    // Validate the actual Hermite trajectory, not just its straight-line chord.
    let start = Math.max(0, ...reservations.filter(r => r.id === item.id).map(r => r.end))
    const latest = total + 30
    while (start <= latest && !temporalSafe(item, route, start, items, reservations)) start += 45
    if (start > latest) {
      route = createRoute(points)
      start = total + 1
      if (!temporalSafe(item, route, start, items, reservations)) return false
      diagnostics.push(`${item.id}:velocity-brake`)
    }
    else if (start > 0 && Math.hypot(item.velocity.x, item.velocity.y) > 1) diagnostics.push(`${item.id}:queued-brake`)
    reservations.push({ id: item.id, route, start, end: start + route.duration, kind, edge })
    total = Math.max(total, start + route.duration)
    positions.set(item.id, points[points.length-1])
    if (kind === 'exit') positions.delete(item.id)
    if (points.length > 2) diagnostics.push(`${item.id}:detour-${points.length-2}`)
    if (start > 0) diagnostics.push(`${item.id}:wait-${Math.round(start)}`)
    return true
  }
  while (pending.length && budget-- > 0) {
    let progress = false
    for (let index = 0; index < pending.length; index++) {
      const item = pending[index], from = positions.get(item.id) ?? item.current
      const obstacles = [...positions].filter(([id]) => id !== item.id).map(([, p]) => p)
      if (!item.visible) {
        const candidates = edgeCandidates(from, geometry)
        for (let c = 0; c < candidates.length; c++) {
          const candidate = candidates[c], path = safePath(from, candidate.point, obstacles)
          if (path && add(item, path, 'exit', candidate.edge)) {
            if (c) diagnostics.push(`${item.id}:alternate-exit-${candidate.edge}`)
            progress = true; break
          }
        }
      } else {
        const to = targets.get(item.id)!
        if (item.present || positions.has(item.id)) {
          if (distance(from, to) < .1) { positions.set(item.id, to); progress = true }
          else { const path = safePath(from, to, obstacles); if (path) progress = add(item, path, 'move') }
        } else {
          const entries = edgeCandidates(to, geometry, item.edge)
          for (const entry of entries) {
            const path = safePath(entry.point, to, obstacles)
            if (path && add(item, path, 'enter', entry.edge)) { progress = true; break }
          }
        }
      }
      if (progress) { pending.splice(index, 1); break }
    }
    if (progress) continue
    // A dependency cycle can require one temporary, collision-checked parking seat.
    const blockers=[...pending,...items.filter(i=>!pending.some(p=>p.id===i.id))]
      .filter(i=>i.present&&positions.has(i.id)&&!parked.has(i.id))
    for (const blocker of blockers) {
      const from = positions.get(blocker.id)!, obstacles = [...positions].filter(([id]) => id !== blocker.id).map(([, p]) => p)
      const envelope = { left: Math.min(...obstacles.map(p=>p.x), from.x)-460,
        right: Math.max(...obstacles.map(p=>p.x), from.x)+460,
        top: Math.min(...obstacles.map(p=>p.y), from.y)-500, bottom: Math.max(...obstacles.map(p=>p.y), from.y)+500 }
      const candidates = [{ x: envelope.left, y: from.y }, { x: envelope.right, y: from.y }, { x: from.x, y: envelope.top }, { x: from.x, y: envelope.bottom }]
        .sort((a,b)=>distance(from,a)-distance(from,b))
      for (const p of candidates) { const path = safePath(from,p,obstacles); if (path && add(blocker,path,'park')) { progress=true; break } }
      parked.add(blocker.id)
      if (progress) {
        diagnostics.push(`${blocker.id}:parking-cycle`)
        if(!pending.some(i=>i.id===blocker.id))pending.push(blocker)
        break
      }
    }
    if(progress)continue
    break
  }
  if (allowStableFallback&&pending.some(i=>i.visible)&&visible.every(i=>i.present)&&
    visible.every((a,i)=>visible.slice(0,i).every(b=>!boxesOverlap(a.current,b.current)))) {
    // Discard unsuccessful parking/compaction before it reaches the renderer.
    // Keeping already legal current seats is safer than stranding a survivor offscreen.
    const stable=new Map(visible.map(i=>[i.id,{...i.current}]))
    const recovery=planScene(items,slots,geometry,stable,false)
    recovery.diagnostics.unshift('compaction-deferred:stable-current-layout')
    return recovery
  }
  for (const item of pending) {
    diagnostics.push(`${item.id}:retain-safe-position`)
    if (item.visible && positions.has(item.id)) targets.set(item.id, positions.get(item.id)!)
  }
  return { reservations, targets, diagnostics, duration: total }
}
export function sampleItem(item: SceneItem, plan: ScenePlan, elapsed: number) {
  let point = item.current, velocity = zero(), present = item.present, phase = 'idle'
  for (const r of plan.reservations) if (r.id === item.id) {
    if (elapsed < r.start) { phase = r.kind === 'enter' && !present ? 'waiting' : 'queued'; break }
    const sample = sampleRoute(r.route, elapsed-r.start)
    point = sample.point; velocity = sample.velocity
    present = r.kind === 'exit' ? elapsed < r.end : true
    phase = elapsed >= r.end ? 'idle' : r.kind
    if (elapsed < r.end) break
  }
  return { point, velocity, present, phase }
}
export function pointerIntent(startId: string | undefined, endId: string | undefined, moved: number, touch: boolean, multiple: boolean, cancelled: boolean) {
  if (multiple || cancelled || moved > (touch ? 7 : 3)) return 'gesture'
  return startId && startId === endId ? 'select' : !startId && !endId ? 'clear' : 'none'
}

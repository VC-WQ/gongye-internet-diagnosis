/** Scene coordinates are always expressed in SVG viewBox units. */
export type Camera = { x: number; y: number; zoom: number }
export function boundCamera(camera: Camera): Camera {
  return {
    x: Math.max(-560, Math.min(560, camera.x)),
    y: Math.max(-420, Math.min(420, camera.y)),
    zoom: Math.max(.6, Math.min(2.1, camera.zoom)),
  }
}
export function zoomAt(camera: Camera, factor: number, anchor: { x: number; y: number }): Camera {
  const zoom = Math.max(.6, Math.min(2.1, camera.zoom * factor))
  const ratio = zoom / camera.zoom
  return boundCamera({
    zoom,
    x: (anchor.x - 450) * (1 - ratio) + camera.x * ratio,
    y: (anchor.y - 330) * (1 - ratio) + camera.y * ratio,
  })
}


export type ScenePoint = { x: number; y: number }
/** 两指以原质心缩放，再平移到新质心。每个输入事件只更新一次镜头。 */
export function pinchCamera(camera: Camera, before: [ScenePoint, ScenePoint], after: [ScenePoint, ScenePoint]): Camera {
  const center = (points: [ScenePoint, ScenePoint]) => ({
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  })
  const distance = (points: [ScenePoint, ScenePoint]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
  const oldCenter = center(before), newCenter = center(after)
  const oldDistance = distance(before)
  const factor = oldDistance > .001 ? distance(after) / oldDistance : 1
  const scaled = zoomAt(camera, factor, oldCenter)
  return boundCamera({ ...scaled, x: scaled.x + newCenter.x - oldCenter.x, y: scaled.y + newCenter.y - oldCenter.y })
}

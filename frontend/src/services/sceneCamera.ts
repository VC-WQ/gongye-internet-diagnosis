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

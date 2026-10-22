export interface TextLayerSnapshot { text: string; y: number; height: number }
/** Preserve every currently visible row; an offscreen pending string is not the old screen. */
export function textHandoff(layers: TextLayerSnapshot[], height: number) {
  const visible = layers.filter(row => row.y + row.height > .1 && row.y < height - .1)
  return { visible, distance: Math.max(height, ...visible.map(row => row.y + row.height)) }
}

/** Continue a keyed row from its previous painted position after a table layout. */
export function tableRowStart(previousTarget: number | undefined, nextTarget: number, offset = 0, opacity = 1) {
  if (![nextTarget, offset, opacity].every(Number.isFinite)) return undefined
  if (previousTarget === undefined) return { y: 8, opacity: 0 }
  if (!Number.isFinite(previousTarget)) return undefined
  const y = previousTarget + offset - nextTarget
  if (Math.abs(y) < 0.5 && opacity >= 0.999) return undefined
  return { y, opacity: Math.max(0, Math.min(1, opacity)) }
}

import type { OrthographicCamera } from 'three'

export type Affine = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>
type Point2 = Readonly<{ x: number; y: number }>
type Point3 = Point2 & Readonly<{ z: number }>
type ViewBox = Readonly<{ x: number; y: number; width: number; height: number }>

const X_SCALE = 51.5
const GROUND_Y_SCALE = 27.25
const HEIGHT_SCALE = Math.sqrt(2 * (X_SCALE ** 2 - GROUND_Y_SCALE ** 2))
const SCREEN_SCALE = X_SCALE * Math.SQRT2
const SIN_THETA = GROUND_Y_SCALE / X_SCALE
const COS_THETA = Math.sqrt(1 - SIN_THETA ** 2)
const CAMERA_DISTANCE = 20
const NEAR = .1
const FAR = 100

function determinant(matrix: Affine) { return matrix.a * matrix.d - matrix.b * matrix.c }
function finiteAffine(matrix: Affine) {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
}
function nonsingular(matrix: Affine) {
  const det = determinant(matrix)
  // Relative tolerance rejects nearly collinear axes without rejecting a small,
  // well-conditioned uniform scale. Translation is irrelevant to invertibility.
  const magnitude = Math.max(Math.abs(matrix.a), Math.abs(matrix.b), Math.abs(matrix.c), Math.abs(matrix.d))
  return finiteAffine(matrix) && Number.isFinite(det) && magnitude > 0 && Math.abs(det) > 1e-12 * magnitude ** 2
}
function positiveAffine(matrix: Affine) { return nonsingular(matrix) && determinant(matrix) > 0 }
function validSize(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
}
function multiply(left: Affine, right: Affine): Affine {
  return {
    a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

/** Root/node screen CTMs -> the shared, untransformed overlay's CSS pixels.
 * Supports the SVG root's default xMidYMid meet only, and ordinary 2D affine
 * transforms. A reflected final projection is rejected to preserve front faces.
 */
export function relativeAffine(svgCTM: Affine, nodeCTM: Affine, viewBox: ViewBox, width: number, height: number): Affine | null {
  if (!validSize(width, height) || !validSize(viewBox.width, viewBox.height) ||
    !Number.isFinite(viewBox.x) || !Number.isFinite(viewBox.y) || !nonsingular(svgCTM) || !finiteAffine(nodeCTM)) return null
  const det = determinant(svgCTM)
  const inverse: Affine = {
    a: svgCTM.d / det, b: -svgCTM.b / det, c: -svgCTM.c / det, d: svgCTM.a / det,
    e: (svgCTM.c * svgCTM.f - svgCTM.d * svgCTM.e) / det,
    f: (svgCTM.b * svgCTM.e - svgCTM.a * svgCTM.f) / det,
  }
  const scale = Math.min(width / viewBox.width, height / viewBox.height)
  const viewport: Affine = {
    a: scale, b: 0, c: 0, d: scale,
    e: (width - scale * viewBox.width) / 2 - scale * viewBox.x,
    f: (height - scale * viewBox.height) / 2 - scale * viewBox.y,
  }
  const result = multiply(viewport, multiply(inverse, nodeCTM))
  return positiveAffine(result) ? result : null
}

/** Closed form of the existing SVG platform's isometric seam, in CSS pixels. */
export function projectDevicePoint(matrix: Affine, point: Point3): { x: number; y: number } {
  if (!positiveAffine(matrix) || ![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new RangeError('Invalid device projection')
  }
  const x = X_SCALE * (point.x - point.z)
  const y = 19.5 + GROUND_Y_SCALE * (point.x + point.z) - HEIGHT_SCALE * point.y
  const result = { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) throw new RangeError('Device projection overflow')
  return result
}

/** Keep view/world rigid: Three removes scale from camera.matrixWorldInverse.
 * CTM scale/shear instead live in this custom projection. Rendering may call
 * updateMatrixWorld/updateWorldMatrix normally; do not subsequently call the
 * default updateProjectionMatrix, which would replace this calibrated matrix.
 * Returns false without mutating the camera for unsupported/invalid inputs.
 */
export function configureDeviceCamera(camera: OrthographicCamera, matrix: Affine, width: number, height: number): boolean {
  // 2000 is Three's WebGLCoordinateSystem. Keep this module's Three import type
  // only, so the default 2D anchor bridge does not eagerly load the renderer.
  if (!validSize(width, height) || !positiveAffine(matrix) || camera.coordinateSystem !== 2000 || camera.reversedDepth) return false
  const originX = matrix.c * 19.5 + matrix.e
  const originY = matrix.d * 19.5 + matrix.f
  const values = [
    2 * SCREEN_SCALE * matrix.a / width, -2 * SCREEN_SCALE * matrix.c / width, 0, 2 * originX / width - 1,
    -2 * SCREEN_SCALE * matrix.b / height, 2 * SCREEN_SCALE * matrix.d / height, 0, 1 - 2 * originY / height,
    0, 0, -2 / (FAR - NEAR), -(FAR + NEAR) / (FAR - NEAR),
    0, 0, 0, 1,
  ]
  const xyDet = values[0] * values[5] - values[1] * values[4]
  const projectionDet = xyDet * values[10]
  const inverseValues = [values[5] / xyDet, -values[1] / xyDet, -values[4] / xyDet, values[0] / xyDet,
    (values[1] * values[7] - values[5] * values[3]) / xyDet,
    (values[4] * values[3] - values[0] * values[7]) / xyDet]
  if (!values.every(Number.isFinite) || !inverseValues.every(Number.isFinite) ||
    !Number.isFinite(projectionDet) || !Number.isFinite(1 / projectionDet)) return false
  camera.near = NEAR
  camera.far = FAR
  camera.zoom = 1
  camera.scale.set(1, 1, 1)
  camera.up.set(0, 1, 0)
  camera.position.set(CAMERA_DISTANCE * COS_THETA / Math.SQRT2, CAMERA_DISTANCE * SIN_THETA, CAMERA_DISTANCE * COS_THETA / Math.SQRT2)
  camera.lookAt(0, 0, 0)
  camera.updateMatrix()
  camera.updateMatrixWorld(true)
  camera.projectionMatrix.set(
    values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7],
    values[8], values[9], values[10], values[11], values[12], values[13], values[14], values[15],
  )
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  return true
}

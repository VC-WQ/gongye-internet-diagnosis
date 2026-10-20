/**
 * 登录 A/B 时间线纯函数。
 *
 * A：红色全屏覆盖已在终点前直接左移，末端轻微过冲后回稳；没有启动反向动作。
 * B：红色先轻微反向蓄力再左移（无末端过冲）；登录面板先微放大再缩圆消失；
 *    白色/米白背景仅在面板收缩进度 ≥50% 后跟随；目标页在下方已准备。
 */

export interface AFrame {
  rightInset: number
  brandOpacity: number
}

export interface BFrame {
  redRightInset: number
  panelScale: number
  panelRadius: number
  panelOpacity: number
  paperX: number
  panelProgress: number
}

export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value))

export const smooth = (value: number) => {
  const x = clamp(value)
  return x * x * (3 - 2 * x)
}

const easeOutCubic = (value: number) => {
  const x = clamp(value)
  return 1 - Math.pow(1 - x, 3)
}

const easeInOut = (value: number) => {
  const x = clamp(value)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

/** A 帧：rightInset 从 0 到品牌栏占比；0.9 处略过冲，终点回稳。 */
export function sampleA(t: number, brandRatio: number): AFrame {
  // clip-path 的 right inset = 1 - 红色右缘位置；终点恰好覆盖左侧品牌列。
  const target = 1 - clamp(brandRatio, 0.2, 0.8)
  const p = clamp(t)
  const overshoot = Math.min(1, target * 1.018)
  let rightInset: number
  if (p <= 0.9) {
    rightInset = overshoot * easeOutCubic(p / 0.9)
  } else {
    rightInset = overshoot + (target - overshoot) * smooth((p - 0.9) / 0.1)
  }
  return {
    rightInset: clamp(rightInset, 0, 1),
    brandOpacity: smooth((p - 0.15) / 0.25),
  }
}

/** B 帧：单一进度驱动红色、面板、纸层。 */
export function sampleB(t: number, brandRatio: number): BFrame {
  const start = 1 - clamp(brandRatio, 0.2, 1)
  const p = clamp(t)
  const prep = smooth(p / 0.12)
  const collapse = p <= 0.12 ? 0 : easeInOut((p - 0.12) / 0.88)

  // 启动预备：红色先向反方向多覆盖 2.5%，随后直接左移，终点不越界。
  const anticipation = 0.025
  const redStart = Math.max(0, start - anticipation)
  let redRightInset: number
  if (p <= 0.12) {
    redRightInset = start - anticipation * prep
  } else {
    redRightInset =
      redStart + (1 - redStart) * easeInOut((p - 0.12) / 0.88)
  }

  // 面板：1 → 1.03 的预备放大，再向圆形收缩到 0，没有终点回弹。
  const panelScale = p <= 0.12 ? 1 + 0.03 * prep : 1.03 * (1 - collapse)
  const panelRadius = 50 * smooth(collapse)
  const paperStart = 0.5
  const paperProgress =
    collapse <= paperStart ? 0 : easeInOut((collapse - paperStart) / (1 - paperStart))

  return {
    redRightInset: clamp(redRightInset, 0, 1),
    panelScale: Math.max(0, panelScale),
    panelRadius,
    panelOpacity: clamp(1 - Math.max(0, collapse - 0.86) / 0.14),
    paperX: -paperProgress,
    panelProgress: collapse,
  }
}

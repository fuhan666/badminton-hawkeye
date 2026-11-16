import type { GroundPoint } from './court'
import { FULL_VIEW } from './viewport'
import type { ViewBox } from './viewport'

/** 方向键微调步长：默认 1 mm，按住 Shift 为 10 mm。 */
export const NUDGE_STEP = 0.001
export const NUDGE_STEP_LARGE = 0.01

export type NudgeKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

const AXIS: Record<NudgeKey, GroundPoint> = {
  ArrowLeft: { x: -1, z: 0 },
  ArrowRight: { x: 1, z: 0 },
  ArrowUp: { x: 0, z: -1 },
  ArrowDown: { x: 0, z: 1 },
}

const KEYS = Object.keys(AXIS) as NudgeKey[]

export function isNudgeKey(key: string): key is NudgeKey {
  return (KEYS as string[]).includes(key)
}

/** 消掉浮点累加误差，保持读数仍是毫米整数。 */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * 按方向键移动一个点：+x 向右、+z 向下，与球场俯视坐标一致。
 * 移动范围限制在给定视图内，避免点被推出可选区。
 */
export function nudgePoint(
  point: GroundPoint,
  key: NudgeKey,
  large = false,
  bounds: ViewBox = FULL_VIEW,
): GroundPoint {
  const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP
  const axis = AXIS[key]
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max)

  return {
    x: round(clamp(point.x + axis.x * step, bounds.minX, bounds.minX + bounds.width)),
    z: round(clamp(point.z + axis.z * step, bounds.minZ, bounds.minZ + bounds.height)),
  }
}

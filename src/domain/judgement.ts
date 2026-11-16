import { CONTACT_RADIUS, VALID_AREA } from './court'
import type { GroundPoint, MatchFormat } from './court'

/** 浮点容差，单位米；相切必须判为界内。 */
export const TOUCH_TOLERANCE = 1e-9

export interface RectBounds {
  halfWidth: number
  halfLength: number
}

export function boundsFor(format: MatchFormat): RectBounds {
  return VALID_AREA[format]
}

/** 有效矩形上离 P 最近的点；矩形内返回 P 本身。 */
export function nearestPointOnBounds(
  point: GroundPoint,
  bounds: RectBounds,
): GroundPoint {
  const x = Math.min(Math.max(point.x, -bounds.halfWidth), bounds.halfWidth)
  const z = Math.min(Math.max(point.z, -bounds.halfLength), bounds.halfLength)
  return { x, z }
}

/** 圆心到有效矩形的最短距离；圆心在区域内为 0。 */
export function distanceToBounds(
  point: GroundPoint,
  bounds: RectBounds,
): number {
  const nearest = nearestPointOnBounds(point, bounds)
  return Math.hypot(point.x - nearest.x, point.z - nearest.z)
}

/**
 * 接触圆与有效区域相交或相切为 IN，完全分离为 OUT。
 * 角落按到角点的距离判定，不做轴向扩张。
 */
export function isInsideCourt(
  point: GroundPoint,
  format: MatchFormat,
  radius: number = CONTACT_RADIUS,
): boolean {
  return distanceToBounds(point, boundsFor(format)) <= radius + TOUCH_TOLERANCE
}

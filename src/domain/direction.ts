import type { GroundPoint, MatchFormat } from './court'

/**
 * 两点距离小于该值视为重合，不产生方向。单位：米。
 * 采集方向时距离本身不参与计算，只用单位向量。
 */
export const MIN_DIRECTION_DISTANCE = 0.01

export type DirectionIssue = 'missing' | 'coincident'

export interface DirectionResult {
  /** 指向落点的单位向量；来向点缺失或重合时为 null。 */
  unit: GroundPoint | null
  /** 两点实际距离，仅用于提示，不进入回放输入。 */
  distance: number
  issue: DirectionIssue | null
}

/**
 * 来向点只决定方向：方向取 (落点 - 来向点) 的单位向量。
 * 同方向不同距离的来向点得到同一个单位向量。
 */
export function resolveDirection(
  landing: GroundPoint,
  incoming: GroundPoint | null,
): DirectionResult {
  if (!incoming) {
    return { unit: null, distance: Number.POSITIVE_INFINITY, issue: 'missing' }
  }

  const dx = landing.x - incoming.x
  const dz = landing.z - incoming.z
  const distance = Math.hypot(dx, dz)

  if (distance < MIN_DIRECTION_DISTANCE) {
    return { unit: null, distance, issue: 'coincident' }
  }

  return { unit: { x: dx / distance, z: dz / distance }, distance, issue: null }
}

export type FlightHeight = 'low' | 'medium' | 'high'

/** 来向点坐标与距离不进入回放输入，只保留单位方向。 */
export interface ReplayInput {
  format: MatchFormat
  landing: GroundPoint
  direction: GroundPoint
  flightHeight: FlightHeight
}

export function buildReplayInput(
  format: MatchFormat,
  landing: GroundPoint,
  incoming: GroundPoint | null,
  flightHeight: FlightHeight,
): ReplayInput | null {
  const { unit } = resolveDirection(landing, incoming)
  if (!unit) return null
  return { format, landing: { ...landing }, direction: unit, flightHeight }
}

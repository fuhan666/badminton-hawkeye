/**
 * 球场几何常量。尺寸量至线外沿，白线属于其所界定的区域。
 * 单位：米。俯视图 +x 向右、+z 向下，球网位于 z = 0。
 */

export type MatchFormat = 'singles' | 'doubles'

export interface GroundPoint {
  x: number
  z: number
}

export const COURT = {
  length: 13.4,
  halfLength: 6.7,
  doublesWidth: 6.1,
  doublesHalfWidth: 3.05,
  singlesWidth: 5.18,
  singlesHalfWidth: 2.59,
  lineWidth: 0.04,
  shortServiceLineFromNet: 1.98,
  doublesLongServiceLineFromBackLine: 0.76,
  netPostHeight: 1.55,
  netCentreHeight: 1.524,
} as const

export const VALID_AREA = {
  doubles: { halfWidth: 3.05, halfLength: 6.7 },
  singles: { halfWidth: 2.59, halfLength: 6.7 },
} as const

/** 模拟接触半径，初始建议，待样片确认 */
export const CONTACT_RADIUS = 0.013

export const LINE = {
  /** 描边中心线位置，线带为中心线 ± 0.02 */
  doublesSidelineX: 3.03,
  singlesSidelineX: 2.57,
  endLineZ: 6.68,
  shortServiceLineZ: 2.0,
  doublesLongServiceLineZ: 5.92,
} as const

/** 全场视图四周保留的场外可选区，便于选到出界落点 */
export const OUTSIDE_MARGIN = 1

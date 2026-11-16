import { COURT, OUTSIDE_MARGIN } from './court'
import type { GroundPoint } from './court'

export interface ViewBox {
  minX: number
  minZ: number
  width: number
  height: number
}

/**
 * 全场视图：球场四周保留 1 m 场外可选区。
 * 本地显示与交互共用这一米制窗口，缩放不改变圆心数值。
 */
export const FULL_VIEW: ViewBox = {
  minX: -(COURT.doublesHalfWidth + OUTSIDE_MARGIN),
  minZ: -(COURT.halfLength + OUTSIDE_MARGIN),
  width: 2 * (COURT.doublesHalfWidth + OUTSIDE_MARGIN),
  height: 2 * (COURT.halfLength + OUTSIDE_MARGIN),
}

/** 局部视图宽度，取 0.24 m 时 13 mm 圆约 18 px、40 mm 线约 55 px，压线与相切可分辨。 */
export const ZOOM_WIDTH = 0.24
export const ZOOM_HEIGHT = 0.17

/** 以圆心为中心的局部视图窗口，等比缩放。 */
export function zoomView(center: GroundPoint): ViewBox {
  return {
    minX: center.x - ZOOM_WIDTH / 2,
    minZ: center.z - ZOOM_HEIGHT / 2,
    width: ZOOM_WIDTH,
    height: ZOOM_HEIGHT,
  }
}

export function toViewBoxString(view: ViewBox): string {
  return `${view.minX} ${view.minZ} ${view.width} ${view.height}`
}

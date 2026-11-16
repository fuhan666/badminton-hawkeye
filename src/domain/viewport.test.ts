import { describe, expect, it } from 'vitest'
import { FULL_VIEW, ZOOM_HEIGHT, ZOOM_WIDTH, toViewBoxString, zoomView } from './viewport'

describe('FULL_VIEW', () => {
  it('keeps a 1 m outside margin around the doubles court', () => {
    expect(FULL_VIEW.minX).toBeCloseTo(-4.05, 12)
    expect(FULL_VIEW.minZ).toBeCloseTo(-7.7, 12)
    expect(FULL_VIEW.width).toBeCloseTo(8.1, 12)
    expect(FULL_VIEW.height).toBeCloseTo(15.4, 12)
  })

  it('centres the net on the vertical middle of the view', () => {
    expect(FULL_VIEW.minZ + FULL_VIEW.height / 2).toBeCloseTo(0, 12)
  })
})

describe('zoomView', () => {
  it('centres a fixed, equal-scale window on the contact circle', () => {
    const view = zoomView({ x: 3.055, z: 0 })
    expect(view.width).toBe(ZOOM_WIDTH)
    expect(view.height).toBe(ZOOM_HEIGHT)
    expect(view.minX + view.width / 2).toBeCloseTo(3.055, 12)
    expect(view.minZ + view.height / 2).toBeCloseTo(0, 12)
  })

  it('keeps pixels per metre equal on both axes', () => {
    expect(ZOOM_WIDTH / ZOOM_HEIGHT).toBeCloseTo(0.24 / 0.17, 12)
  })

  it('serialises to an SVG viewBox', () => {
    expect(toViewBoxString({ minX: -1, minZ: 2, width: 4, height: 8 })).toBe('-1 2 4 8')
  })
})

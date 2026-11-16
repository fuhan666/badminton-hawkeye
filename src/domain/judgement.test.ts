import { describe, expect, it } from 'vitest'
import { CONTACT_RADIUS } from './court'
import {
  distanceToBounds,
  isInsideCourt,
  nearestPointOnBounds,
} from './judgement'

const R = CONTACT_RADIUS

describe('nearestPointOnBounds', () => {
  it('keeps a point inside the rectangle unchanged', () => {
    expect(nearestPointOnBounds({ x: 1, z: -2 }, { halfWidth: 3.05, halfLength: 6.7 })).toEqual({
      x: 1,
      z: -2,
    })
  })

  it('clamps per axis instead of expanding the rectangle', () => {
    expect(nearestPointOnBounds({ x: 3.06, z: 6.71 }, { halfWidth: 3.05, halfLength: 6.7 })).toEqual({
      x: 3.05,
      z: 6.7,
    })
  })
})

describe('distanceToBounds', () => {
  it('is zero inside the valid rectangle', () => {
    expect(distanceToBounds({ x: 0, z: 0 }, { halfWidth: 3.05, halfLength: 6.7 })).toBe(0)
  })

  it('uses the diagonal distance at a corner', () => {
    const d = distanceToBounds({ x: 3.06, z: 6.71 }, { halfWidth: 3.05, halfLength: 6.7 })
    expect(d).toBeCloseTo(Math.hypot(0.01, 0.01), 12)
  })
})

describe('isInsideCourt - in court and on the lines', () => {
  it('treats the centre as IN for both formats', () => {
    expect(isInsideCourt({ x: 0, z: 0 }, 'singles')).toBe(true)
    expect(isInsideCourt({ x: 0, z: 0 }, 'doubles')).toBe(true)
  })

  it('treats a centre placed on a line centre as IN', () => {
    expect(isInsideCourt({ x: 3.03, z: 0 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 2.57, z: 0 }, 'singles')).toBe(true)
    expect(isInsideCourt({ x: 0, z: 6.68 }, 'doubles')).toBe(true)
  })

  it('treats a partially overlapping circle as IN', () => {
    expect(isInsideCourt({ x: 3.055, z: 0 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 0, z: 6.705 }, 'doubles')).toBe(true)
  })
})

describe('isInsideCourt - tangency on the doubles outer edge', () => {
  it('is IN exactly at the tangent point', () => {
    // 3.063 - 3.05 === 0.013000000000000012 in float64
    expect(isInsideCourt({ x: 3.063, z: 0 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: -3.063, z: 0 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 0, z: -6.713 }, 'doubles')).toBe(true)
  })

  it('is OUT one millimetre past the tangent point', () => {
    expect(isInsideCourt({ x: 3.064, z: 0 }, 'doubles')).toBe(false)
    expect(isInsideCourt({ x: -3.064, z: 0 }, 'doubles')).toBe(false)
  })

  it('resolves both sides of the tangent point along the normal', () => {
    expect(isInsideCourt({ x: 3.05 + R - 1e-6, z: 0 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 3.05 + R + 1e-6, z: 0 }, 'doubles')).toBe(false)
    expect(isInsideCourt({ x: 0, z: 6.7 + R - 1e-6 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 0, z: 6.7 + R + 1e-6 }, 'doubles')).toBe(false)
  })
})

describe('isInsideCourt - corners', () => {
  it('accepts a corner overlap and rejects a separated corner', () => {
    expect(isInsideCourt({ x: 3.055, z: 6.705 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 3.06, z: 6.71 }, 'doubles')).toBe(false)
  })

  it('uses the diagonal distance, not an axis-expanded rectangle', () => {
    // Each axis offset is under r, so an axis-expanded rectangle would call this IN.
    expect(isInsideCourt({ x: 3.0629, z: 6.7129 }, 'doubles')).toBe(false)
  })

  it('resolves both sides of a diagonal tangent point in every corner', () => {
    const offset = R / Math.SQRT2
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cornerX = sx * 3.05
        const cornerZ = sz * 6.7
        const tangent = { x: cornerX + sx * offset, z: cornerZ + sz * offset }
        const out = { x: cornerX + sx * (offset + 1e-6), z: cornerZ + sz * (offset + 1e-6) }
        const inside = { x: cornerX + sx * (offset - 1e-6), z: cornerZ + sz * (offset - 1e-6) }
        expect(isInsideCourt(tangent, 'doubles')).toBe(true)
        expect(isInsideCourt(out, 'doubles')).toBe(false)
        expect(isInsideCourt(inside, 'doubles')).toBe(true)
      }
    }
  })
})

describe('isInsideCourt - format differences', () => {
  it('calls the doubles alley OUT for singles but IN for doubles', () => {
    expect(isInsideCourt({ x: 2.7, z: 0 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 2.7, z: 0 }, 'singles')).toBe(false)
    expect(isInsideCourt({ x: -2.7, z: 0 }, 'singles')).toBe(false)
  })

  it('keeps a circle resting on the singles line IN for singles', () => {
    expect(isInsideCourt({ x: 2.595, z: 0 }, 'singles')).toBe(true)
    expect(isInsideCourt({ x: 2.595, z: 0 }, 'doubles')).toBe(true)
  })

  it('keeps both formats equal along the length axis', () => {
    for (const z of [6.7, -6.7, 6.71, 5.0]) {
      expect(isInsideCourt({ x: 0, z }, 'singles')).toBe(isInsideCourt({ x: 0, z }, 'doubles'))
    }
  })
})

describe('isInsideCourt - tolerance regression', () => {
  it('accepts distance just under r + 1e-9 and rejects beyond it', () => {
    expect(isInsideCourt({ x: 3.05 + R + 5e-10, z: 0 }, 'doubles')).toBe(true)
    expect(isInsideCourt({ x: 3.05 + R + 2e-9, z: 0 }, 'doubles')).toBe(false)
  })

  it('does not widen the radius visibly', () => {
    expect(isInsideCourt({ x: 3.05 + R + 1e-5, z: 0 }, 'doubles')).toBe(false)
    expect(isInsideCourt({ x: 3.05 + R * 2, z: 0 }, 'doubles')).toBe(false)
  })
})

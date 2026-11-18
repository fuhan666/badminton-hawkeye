import { describe, expect, it } from 'vitest'
import {
  MIN_DIRECTION_DISTANCE,
  buildReplayInput,
  resolveDirection,
} from './direction'

const LANDING = { x: 2.4, z: 1.2 }

describe('resolveDirection - normalisation', () => {
  it('produces the same direction for the same ray at different distances', () => {
    const near = resolveDirection(LANDING, { x: 2.4, z: 1.5 })
    const far = resolveDirection(LANDING, { x: 2.4, z: 4.5 })
    expect(near.unit).toEqual(far.unit)
    expect(near.unit).toEqual({ x: 0, z: -1 })
    expect(near.distance).not.toBeCloseTo(far.distance, 6)
  })

  it('normalises an arbitrary diagonal to unit length', () => {
    const { unit } = resolveDirection(LANDING, { x: 1.4, z: 0.2 })
    expect(unit).not.toBeNull()
    expect(Math.hypot(unit!.x, unit!.z)).toBeCloseTo(1, 12)
    expect(unit!.x).toBeCloseTo(0.7071, 4)
    expect(unit!.z).toBeCloseTo(0.7071, 4)
  })

  it('points from the incoming point toward the landing point', () => {
    // 来向点在落点左侧，球向右飞行 (+x)
    const { unit } = resolveDirection({ x: 3, z: 0 }, { x: 2, z: 0 })
    expect(unit).toEqual({ x: 1, z: 0 })
  })

  it('covers all four axis directions', () => {
    const expected = [
      [{ x: 3.4, z: 1.2 }, { x: -1, z: 0 }],
      [{ x: 1.4, z: 1.2 }, { x: 1, z: 0 }],
      [{ x: 2.4, z: 2.2 }, { x: 0, z: -1 }],
      [{ x: 2.4, z: 0.2 }, { x: 0, z: 1 }],
    ] as const
    for (const [incoming, unit] of expected) {
      expect(resolveDirection(LANDING, incoming).unit).toEqual(unit)
    }
  })
})

describe('resolveDirection - invalid input', () => {
  it('reports a missing incoming point without a direction', () => {
    const result = resolveDirection(LANDING, null)
    expect(result.unit).toBeNull()
    expect(result.issue).toBe('missing')
  })

  it('rejects coincident points', () => {
    const result = resolveDirection(LANDING, { ...LANDING })
    expect(result.unit).toBeNull()
    expect(result.issue).toBe('coincident')
    expect(result.distance).toBe(0)
  })

  it('rejects points closer than the 1 cm threshold', () => {
    const result = resolveDirection({ x: 0, z: 0 }, { x: 0.009, z: 0 })
    expect(result.unit).toBeNull()
    expect(result.issue).toBe('coincident')
  })

  it('accepts a distance exactly at the threshold', () => {
    const result = resolveDirection({ x: 0, z: 0 }, { x: 0.01, z: 0 })
    expect(result.distance).toBeCloseTo(MIN_DIRECTION_DISTANCE, 12)
    expect(result.issue).toBeNull()
    expect(result.unit).toEqual({ x: -1, z: 0 })
  })

  it('accepts a distance just above the threshold', () => {
    const result = resolveDirection({ x: 0, z: 0 }, { x: 0, z: 0.0101 })
    expect(result.issue).toBeNull()
    expect(result.unit).not.toBeNull()
  })
})

describe('buildReplayInput', () => {
  it('returns null while the direction is missing or coincident', () => {
    expect(buildReplayInput('doubles', LANDING, null, 'medium')).toBeNull()
    expect(buildReplayInput('doubles', LANDING, { ...LANDING }, 'medium')).toBeNull()
  })

  it('carries format, landing, the unit direction and the selected height', () => {
    const input = buildReplayInput('singles', LANDING, { x: 2.4, z: -0.8 }, 'high')
    expect(input).toEqual({
      format: 'singles',
      landing: LANDING,
      direction: { x: 0, z: 1 },
      flightHeight: 'high',
    })
    expect(Object.keys(input!)).toEqual(['format', 'landing', 'direction', 'flightHeight'])
  })

  it('gives identical input for same-direction, different-distance incoming points', () => {
    const near = buildReplayInput('doubles', LANDING, { x: 2.4, z: 1.8 }, 'medium')
    const far = buildReplayInput('doubles', LANDING, { x: 2.4, z: 5.5 }, 'medium')
    expect(near).toEqual(far)
  })
})

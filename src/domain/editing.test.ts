import { describe, expect, it } from 'vitest'
import { NUDGE_STEP, NUDGE_STEP_LARGE, isNudgeKey, nudgePoint } from './editing'
import { isInsideCourt } from './judgement'
import { FULL_VIEW } from './viewport'

describe('nudgePoint', () => {
  it('moves 1 mm per key press on the matching axis', () => {
    const start = { x: 3.055, z: 0 }
    expect(nudgePoint(start, 'ArrowRight')).toEqual({ x: 3.056, z: 0 })
    expect(nudgePoint(start, 'ArrowLeft')).toEqual({ x: 3.054, z: 0 })
    expect(nudgePoint(start, 'ArrowDown')).toEqual({ x: 3.055, z: 0.001 })
    expect(nudgePoint(start, 'ArrowUp')).toEqual({ x: 3.055, z: -0.001 })
    expect(NUDGE_STEP).toBe(0.001)
  })

  it('moves 10 mm with Shift held', () => {
    expect(nudgePoint({ x: 3.055, z: 0 }, 'ArrowRight', true)).toEqual({ x: 3.065, z: 0 })
    expect(nudgePoint({ x: 3.055, z: 0 }, 'ArrowUp', true)).toEqual({ x: 3.055, z: -0.01 })
    expect(NUDGE_STEP_LARGE).toBe(0.01)
  })

  it('reaches the partial-line and fully-out cases from the same start', () => {
    let point = { x: 3.05, z: 0 }
    point = nudgePoint(point, 'ArrowRight', true)
    expect(point).toEqual({ x: 3.06, z: 0 })
    expect(isInsideCourt(point, 'doubles')).toBe(true)

    point = nudgePoint(nudgePoint(nudgePoint(point, 'ArrowRight'), 'ArrowRight'), 'ArrowRight')
    expect(point.x).toBe(3.063)
    expect(isInsideCourt(point, 'doubles')).toBe(true)

    point = nudgePoint(point, 'ArrowRight')
    expect(point.x).toBe(3.064)
    expect(isInsideCourt(point, 'doubles')).toBe(false)
  })

  it('does not accumulate floating point drift', () => {
    let point = { x: 0, z: 0 }
    for (let i = 0; i < 10; i += 1) point = nudgePoint(point, 'ArrowRight')
    expect(point.x).toBe(0.01)
    for (let i = 0; i < 10; i += 1) point = nudgePoint(point, 'ArrowLeft')
    expect(point.x).toBe(0)
  })

  it('clamps at the editable view bounds', () => {
    const left = nudgePoint({ x: FULL_VIEW.minX, z: 0 }, 'ArrowLeft')
    expect(left.x).toBe(FULL_VIEW.minX)
    const bottom = nudgePoint({ x: 0, z: FULL_VIEW.minZ + FULL_VIEW.height }, 'ArrowDown')
    expect(bottom.z).toBe(FULL_VIEW.minZ + FULL_VIEW.height)
  })
})

describe('isNudgeKey', () => {
  it('accepts arrow keys only', () => {
    expect(isNudgeKey('ArrowLeft')).toBe(true)
    expect(isNudgeKey('ArrowDown')).toBe(true)
    expect(isNudgeKey('Enter')).toBe(false)
    expect(isNudgeKey('a')).toBe(false)
  })
})

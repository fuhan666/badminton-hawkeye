import { describe, expect, it } from 'vitest'
import { CONTACT_RADIUS, COURT } from './court'
import { buildReplayInput } from './direction'
import type { ReplayInput } from './direction'
import {
  CONTACT_TIME,
  FOLLOW_END,
  MAX_FLIGHT_HEIGHT,
  OVERVIEW_END,
  REPLAY_DURATION,
  SLOW_MO_END,
  evaluateReplay,
  flightProgressAt,
  replayInputKey,
  replayVerdict,
} from './replay'

function input(landing: { x: number; z: number }, incoming: { x: number; z: number } | null, format: 'singles' | 'doubles' = 'doubles'): ReplayInput {
  const result = buildReplayInput(format, landing, incoming)
  if (!result) throw new Error('测试输入应产生有效方向')
  return result
}

/** 标准跨网输入：从 (0, -3) 打向 (0, 3) */
const CROSS_NET = input({ x: 0, z: 3 }, { x: 0, z: -3 })

describe('evaluateReplay 确定性', () => {
  it('同一输入与时刻两次调用逐字段相等', () => {
    for (const time of [0, 0.37, 1.4, 3.2, 4.75, 5]) {
      expect(evaluateReplay(CROSS_NET, time)).toEqual(evaluateReplay(CROSS_NET, time))
    }
  })

  it('乱序调用与不同帧间隔下同一时刻结果不变', () => {
    const ordered = [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.4].map((t) =>
      evaluateReplay(CROSS_NET, t),
    )
    const shuffled = [4.4, 1.6, 3.2, 0.4, 2.8, 0.8, 3.6, 1.2, 2.4, 2.0].map((t) =>
      evaluateReplay(CROSS_NET, t),
    )
    for (const frame of shuffled) {
      expect(frame).toEqual(ordered.find((item) => item.time === frame.time))
    }
  })

  it('同方向不同距离的来向点产生相同回放', () => {
    const near = input({ x: 1.2, z: 2.4 }, { x: 1.2, z: -0.6 })
    const far = input({ x: 1.2, z: 2.4 }, { x: 1.2, z: -9 })
    expect(replayInputKey(near)).toBe(replayInputKey(far))
    for (const time of [0, 1.1, 2.6, 3.2, 4.9]) {
      expect(evaluateReplay(near, time)).toEqual(evaluateReplay(far, time))
    }
  })

  it('输入键随落点、方向与赛制变化', () => {
    const base = input({ x: 0, z: 3 }, { x: 0, z: -3 })
    expect(replayInputKey(base)).not.toBe(replayInputKey(input({ x: 0.001, z: 3 }, { x: 0, z: -3 })))
    expect(replayInputKey(base)).not.toBe(replayInputKey(input({ x: 0, z: 3 }, { x: 0.5, z: -3 })))
    expect(replayInputKey(base)).not.toBe(
      replayInputKey(input({ x: 0, z: 3 }, { x: 0, z: -3 }, 'singles')),
    )
    expect(replayInputKey(null)).toBe('none')
  })
})

describe('evaluateReplay 球路', () => {
  it('四个正方向与斜向、平行网方向都返回有限数值与单位朝向', () => {
    const cases: { landing: { x: number; z: number }; incoming: { x: number; z: number } }[] = [
      { landing: { x: 0, z: 3 }, incoming: { x: 0, z: -3 } },
      { landing: { x: 0, z: -3 }, incoming: { x: 0, z: 3 } },
      { landing: { x: 3, z: 1 }, incoming: { x: -1, z: 1 } },
      { landing: { x: -3, z: 1 }, incoming: { x: 1, z: 1 } },
      { landing: { x: 2.2, z: 3.6 }, incoming: { x: -1.8, z: -2.4 } },
      { landing: { x: 0.2, z: 4.2 }, incoming: { x: 3.1, z: 4.3 } },
    ]
    for (const item of cases) {
      const replay = input(item.landing, item.incoming)
      for (const time of [0, 0.5, 1.7, 2.9, 3.2, 4.2]) {
        const frame = evaluateReplay(replay, time)
        for (const value of [
          frame.ball.position.x,
          frame.ball.position.y,
          frame.ball.position.z,
          frame.ball.forward.x,
          frame.ball.forward.y,
          frame.ball.forward.z,
          frame.camera.position.x,
          frame.camera.position.y,
          frame.camera.position.z,
          frame.camera.fov,
        ]) {
          expect(Number.isFinite(value)).toBe(true)
        }
        expect(
          Math.hypot(frame.ball.forward.x, frame.ball.forward.y, frame.ball.forward.z),
        ).toBeCloseTo(1, 9)
      }
    }
  })

  it('球沿来向反推的方向前进', () => {
    const frame = evaluateReplay(CROSS_NET, 1.0)
    expect(frame.ball.forward.z).toBeGreaterThan(0)
    const later = evaluateReplay(CROSS_NET, 2.4)
    expect(later.ball.position.z).toBeGreaterThan(frame.ball.position.z)
  })

  it('跨网路径过网净高足够，且最高点不超过上限', () => {
    let crossingHeight: number | null = null
    let previous = evaluateReplay(CROSS_NET, 0)
    let peak = previous.ball.position.y
    for (let time = 0.01; time <= CONTACT_TIME; time += 0.005) {
      const frame = evaluateReplay(CROSS_NET, time)
      peak = Math.max(peak, frame.ball.position.y)
      if (crossingHeight === null && previous.ball.position.z < 0 && frame.ball.position.z >= 0) {
        crossingHeight = frame.ball.position.y
      }
      previous = frame
    }
    expect(crossingHeight).not.toBeNull()
    expect(crossingHeight as number).toBeGreaterThanOrEqual(COURT.netPostHeight)
    expect(peak).toBeLessThanOrEqual(MAX_FLIGHT_HEIGHT + 1e-9)
  })

  it('飞行进度单调不减且触地后为 1', () => {
    let previous = -1
    for (let time = 0; time <= REPLAY_DURATION; time += 0.05) {
      const progress = flightProgressAt(time)
      expect(progress).toBeGreaterThanOrEqual(previous - 1e-12)
      expect(progress).toBeLessThanOrEqual(1 + 1e-12)
      previous = progress
    }
    expect(flightProgressAt(CONTACT_TIME)).toBeCloseTo(1, 12)
    expect(flightProgressAt(REPLAY_DURATION)).toBe(1)
  })
})

describe('触地与印记', () => {
  it('触地时刻起球托底端精确落在圆心', () => {
    const replay = input({ x: 3.063, z: 4.5 }, { x: 3.063, z: -3.5 })
    for (const time of [CONTACT_TIME, 3.3, 4.0, REPLAY_DURATION]) {
      const frame = evaluateReplay(replay, time)
      expect(frame.ball.position).toEqual({ x: 3.063, y: 0, z: 4.5 })
    }
  })

  it('触地前球托始终在地面之上', () => {
    for (let time = 0; time < CONTACT_TIME; time += 0.05) {
      expect(evaluateReplay(CROSS_NET, time).ball.position.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('印记中心与圆心一致，半径与编辑器共享', () => {
    const frame = evaluateReplay(CROSS_NET, 4.4)
    expect(frame.marker.center).toEqual({ x: 0, y: 0, z: 3 })
    expect(frame.marker.radius).toBe(CONTACT_RADIUS)
    expect(frame.marker.opacity).toBeCloseTo(1, 6)
    expect(frame.ball.opacity).toBeCloseTo(0, 6)
  })

  it('结果牌在定格段完全显示', () => {
    const frame = evaluateReplay(CROSS_NET, 4.6)
    expect(frame.resultOpacity).toBeCloseTo(1, 6)
    expect(frame.verdict).toBe('IN')
  })
})

describe('判定结果', () => {
  it('相切判 IN、分离判 OUT、角落按对角距离判 OUT', () => {
    expect(replayVerdict(input({ x: 3.063, z: 0 }, { x: 0, z: 0 }))).toBe('IN')
    expect(replayVerdict(input({ x: 3.064, z: 0 }, { x: 0, z: 0 }))).toBe('OUT')
    expect(replayVerdict(input({ x: 3.06, z: 6.71 }, { x: 0, z: 0 }))).toBe('OUT')
  })

  it('同一落点在单打与双打结果不同', () => {
    const point = { x: 2.7, z: 0 }
    const incoming = { x: 0, z: 0 }
    expect(replayVerdict(input(point, incoming, 'singles'))).toBe('OUT')
    expect(replayVerdict(input(point, incoming, 'doubles'))).toBe('IN')
  })
})

describe('镜头连续性', () => {
  const times = [OVERVIEW_END, FOLLOW_END, SLOW_MO_END]

  it('分镜边界两侧位姿一致', () => {
    // 边界两侧各取 0.1 ms，位移只反映镜头速度，不出现跳变
    for (const boundary of times) {
      const before = evaluateReplay(CROSS_NET, boundary - 1e-4).camera
      const after = evaluateReplay(CROSS_NET, boundary + 1e-4).camera
      expect(after.position.x).toBeCloseTo(before.position.x, 2)
      expect(after.position.y).toBeCloseTo(before.position.y, 2)
      expect(after.position.z).toBeCloseTo(before.position.z, 2)
      expect(after.target.x).toBeCloseTo(before.target.x, 2)
      expect(after.target.y).toBeCloseTo(before.target.y, 2)
      expect(after.target.z).toBeCloseTo(before.target.z, 2)
      expect(after.fov).toBeCloseTo(before.fov, 2)
    }
  })

  it('相邻采样点之间镜头位移是有限的小步长', () => {
    let previous = evaluateReplay(CROSS_NET, 0).camera.position
    for (let time = 0.02; time <= REPLAY_DURATION; time += 0.02) {
      const current = evaluateReplay(CROSS_NET, time).camera.position
      const step = Math.hypot(current.x - previous.x, current.y - previous.y, current.z - previous.z)
      expect(step).toBeLessThan(0.6)
      previous = current
    }
  })

  it('四段分镜随时间推进', () => {
    expect(evaluateReplay(CROSS_NET, 0.4).segment).toBe('overview')
    expect(evaluateReplay(CROSS_NET, 1.4).segment).toBe('follow')
    expect(evaluateReplay(CROSS_NET, 2.8).segment).toBe('slowmo')
    expect(evaluateReplay(CROSS_NET, 4.5).segment).toBe('result')
  })
})

describe('时间越界', () => {
  it('负值与超长时间夹到有效范围', () => {
    expect(evaluateReplay(CROSS_NET, -2)).toEqual(evaluateReplay(CROSS_NET, 0))
    expect(evaluateReplay(CROSS_NET, 99)).toEqual(evaluateReplay(CROSS_NET, REPLAY_DURATION))
    expect(evaluateReplay(CROSS_NET, Number.NaN).time).toBe(0)
  })
})

/** 把地面点投到画面归一化坐标，用于检查近景构图；与渲染层的针孔相机一致 */
function projectNdc(
  camera: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number },
  point: { x: number; z: number },
  aspect = 16 / 9,
) {
  const forward = {
    x: camera.target.x - camera.position.x,
    y: camera.target.y - camera.position.y,
    z: camera.target.z - camera.position.z,
  }
  const forwardLength = Math.hypot(forward.x, forward.y, forward.z)
  const f = { x: forward.x / forwardLength, y: forward.y / forwardLength, z: forward.z / forwardLength }
  const right = { x: f.z, y: 0, z: -f.x }
  const rightLength = Math.hypot(right.x, right.z)
  const r = { x: right.x / rightLength, y: 0, z: right.z / rightLength }
  const up = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  }
  const rel = { x: point.x - camera.position.x, y: -camera.position.y, z: point.z - camera.position.z }
  const depth = rel.x * f.x + rel.y * f.y + rel.z * f.z
  const tan = Math.tan((camera.fov * Math.PI) / 360)
  return {
    x: (rel.x * r.x + rel.z * r.z) / (depth * tan * aspect),
    y: (rel.x * up.x + rel.y * up.y + rel.z * up.z) / (depth * tan),
  }
}

const FRAMING_SCENES = [
  {
    name: '边线压线',
    landing: { x: 3.055, z: 3.2 },
    verdict: 'IN' as const,
    /** 需要同框的线带采样点：双打边线在 x = 3.03–3.07 */
    lines: () =>
      [2.9, 3.05, 3.2].flatMap((z) => [
        { x: 3.03, z },
        { x: 3.07, z },
      ]),
  },
  {
    name: '角落相交',
    landing: { x: 3.055, z: 6.705 },
    verdict: 'IN' as const,
    lines: () => [
      { x: 3.03, z: 6.6 },
      { x: 3.03, z: 6.7 },
      { x: 2.95, z: 6.68 },
      { x: 2.85, z: 6.68 },
    ],
  },
  {
    name: '明显界内',
    landing: { x: 2.2, z: 3.2 },
    verdict: 'IN' as const,
    lines: () => [
      { x: 3.03, z: 3.0 },
      { x: 3.07, z: 3.2 },
      { x: 3.03, z: 3.4 },
    ],
  },
  {
    name: '明显界外',
    landing: { x: 3.3, z: 3.2 },
    verdict: 'OUT' as const,
    lines: () => [
      { x: 3.03, z: 3.0 },
      { x: 3.07, z: 3.2 },
      { x: 3.03, z: 3.4 },
    ],
  },
]

describe('近景构图', () => {
  for (const scene of FRAMING_SCENES) {
    it(`${scene.name}：触地与定格都把落点和所需线带收进画面`, () => {
      const replay = input(scene.landing, { x: scene.landing.x, z: -3.2 })
      expect(replayVerdict(replay)).toBe(scene.verdict)
      for (const time of [CONTACT_TIME, REPLAY_DURATION]) {
        const frame = evaluateReplay(replay, time)
        const landing = projectNdc(frame.camera, scene.landing)
        // 落点留在画面中部，不被结果牌或画框裁掉
        expect(Math.abs(landing.x)).toBeLessThan(0.5)
        expect(landing.y).toBeGreaterThan(-0.5)
        expect(landing.y).toBeLessThan(0.4)
        for (const point of scene.lines()) {
          const ndc = projectNdc(frame.camera, point)
          expect(Math.abs(ndc.x)).toBeLessThan(0.98)
          expect(ndc.y).toBeLessThan(0.98)
          expect(ndc.y).toBeGreaterThan(-0.95)
        }
      }
    })
  }

  it('单打只在单打边线处取景，落点判 OUT 时仍能看到最近的有效边界', () => {
    const replay = input({ x: 2.7, z: 3.2 }, { x: 2.7, z: -3.2 }, 'singles')
    expect(replayVerdict(replay)).toBe('OUT')
    const frame = evaluateReplay(replay, REPLAY_DURATION)
    for (const point of [
      { x: 2.57, z: 3.0 },
      { x: 2.61, z: 3.2 },
      { x: 2.57, z: 3.4 },
    ]) {
      const ndc = projectNdc(frame.camera, point)
      expect(Math.abs(ndc.x)).toBeLessThan(0.98)
      expect(Math.abs(ndc.y)).toBeLessThan(0.98)
    }
  })

  it('镜像落点得到镜像构图，结果仍有限且在地面之上', () => {
    const cases = [
      { x: 3.055, z: -3.2 },
      { x: -3.055, z: 3.2 },
      { x: -3.055, z: -6.705 },
      { x: 3.3, z: -3.2 },
    ]
    for (const landing of cases) {
      const replay = input(landing, { x: 0, z: 2.0 })
      for (const time of [CONTACT_TIME, REPLAY_DURATION]) {
        const camera = evaluateReplay(replay, time).camera
        expect(camera.position.y).toBeGreaterThan(0.8)
        expect(Number.isFinite(camera.position.x + camera.position.z + camera.fov)).toBe(true)
      }
    }
  })
})

describe('镜头净空', () => {
  const landings = [
    { x: 3.055, z: 3.2 },
    { x: 3.055, z: 6.705 },
    { x: 2.2, z: 3.2 },
    { x: 3.3, z: 3.2 },
    { x: 0.4, z: 2.4 },
    { x: 0, z: 0.6 },
    { x: 0, z: 3 },
    { x: -2.4, z: 5.6 },
  ]

  it.each([16 / 9, 9 / 16, 9 / 20, 1, 21 / 9])('%s 画幅：镜头全程在地面之上，且不穿过球网', (aspect) => {
    for (const landing of landings) {
      for (const incoming of [
        { x: landing.x, z: -3.2 },
        { x: landing.x - 2.6, z: -3.2 },
        { x: 0, z: 3.2 },
      ]) {
        const replay = input(landing, incoming)
        for (let time = 0; time <= REPLAY_DURATION; time += 0.02) {
          const p = evaluateReplay(replay, time, aspect).camera.position
          expect(p.y).toBeGreaterThan(0.45)
          const inNetBand = p.y > 0.6 && p.y < COURT.netPostHeight + 0.06
          if (inNetBand) {
            expect(Math.abs(p.z) > 0.3 || Math.abs(p.x) > COURT.doublesHalfWidth + 0.15).toBe(true)
          }
        }
      }
    }
  })
})


describe('横竖画幅构图', () => {
  for (const aspect of [9 / 16, 9 / 20, 1, 4 / 3, 21 / 9]) {
    for (const scene of FRAMING_SCENES) {
      it(`${aspect.toFixed(3)} ${scene.name}：近景落点和参照线始终在画内`, () => {
        const replay = input(scene.landing, { x: scene.landing.x, z: -3.2 })
        for (let time = CONTACT_TIME; time <= REPLAY_DURATION; time += 0.04) {
          const frame = evaluateReplay(replay, time, aspect)
          for (const point of [scene.landing, ...scene.lines()]) {
            const ndc = projectNdc(frame.camera, point, aspect)
            expect(Math.abs(ndc.x)).toBeLessThan(0.98)
            expect(ndc.y).toBeLessThan(0.98)
            expect(ndc.y).toBeGreaterThan(-0.95)
          }
          expect(frame.ball.position).toEqual(evaluateReplay(replay, time).ball.position)
        }
      })
    }
    it(`${aspect.toFixed(3)} 全景四角可见`, () => {
      const frame = evaluateReplay(CROSS_NET, 0, aspect)
      for (const x of [-COURT.doublesHalfWidth, COURT.doublesHalfWidth]) {
        for (const z of [-COURT.halfLength, COURT.halfLength]) {
          const point = projectNdc(frame.camera, { x, z }, aspect)
          expect(Math.abs(point.x)).toBeLessThan(1)
          expect(Math.abs(point.y)).toBeLessThan(1)
        }
      }
    })
  }
})

import { CONTACT_RADIUS } from './court'
import type { ReplayInput } from './direction'
import { isInsideCourt } from './judgement'

/**
 * 三维回放的确定性内核：给定输入与播放时刻，返回球体、镜头、印记与结果的完整状态。
 * 只做纯数值计算，不读时钟、随机数、帧率或上一帧结果，预览与逐帧导出共用。
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type ReplaySegment = 'overview' | 'follow' | 'slowmo' | 'result'

export interface ReplayFrame {
  /** 已夹到 [0, REPLAY_DURATION] 的播放时刻 */
  time: number
  /** 飞行进度 0–1，触地后恒为 1 */
  flightProgress: number
  segment: ReplaySegment
  ball: {
    /** 球托底端世界坐标；触地后精确等于落点圆心 */
    position: Vec3
    /** 球托前进方向的单位向量（世界坐标） */
    forward: Vec3
    opacity: number
  }
  marker: {
    center: Vec3
    /** 与编辑器共享的接触半径，不放大 */
    radius: number
    opacity: number
  }
  camera: {
    position: Vec3
    target: Vec3
    fov: number
  }
  verdict: 'IN' | 'OUT'
  resultOpacity: number
}

/** 回放总长，单位秒 */
export const REPLAY_DURATION = 5
/** 触地时刻，位于慢放段内 */
export const CONTACT_TIME = 3.2

/** 分镜边界 */
export const OVERVIEW_END = 0.8
export const FOLLOW_END = 2.0
export const SLOW_MO_END = 3.6

/** 飞行水平长度：球从落点沿来向反推的起点到落点 */
export const FLIGHT_LENGTH = 4.2
/** 起手高度 */
export const LAUNCH_HEIGHT = 2.5
/** 跨网处目标净高（高于网柱 1.55 m） */
export const NET_CROSSING_HEIGHT = 1.9
/** 轨迹最高点上限 */
export const MAX_FLIGHT_HEIGHT = 6
/** 球体淡出与结果牌淡入的时刻 */
export const BALL_FADE_START = CONTACT_TIME
export const BALL_FADE_END = CONTACT_TIME + 0.25
export const MARKER_FADE_START = CONTACT_TIME + 0.05
export const MARKER_FADE_END = CONTACT_TIME + 0.3
export const RESULT_FADE_START = CONTACT_TIME + 0.15
export const RESULT_FADE_END = CONTACT_TIME + 0.45

/** 飞行进度关键帧：前三段慢下来，触地时正好走完 */
const PROGRESS_KEYS: { t: number; v: number }[] = [
  { t: 0, v: 0 },
  { t: OVERVIEW_END, v: 0.24 },
  { t: FOLLOW_END, v: 0.68 },
  { t: CONTACT_TIME, v: 1 },
]

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function smoothStep(value: number): number {
  const s = clamp(value, 0, 1)
  return s * s * (3 - 2 * s)
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k }
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z)
  if (length < 1e-9) return { x: 0, y: 0, z: 0 }
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

/**
 * 单调三次插值：段内用两端斜率平均值作切线，结果再夹到段端点之间，
 * 保证进度不倒退、不越过 0 或 1。
 */
function evalProgress(keys: { t: number; v: number }[], time: number): number {
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (time <= first.t) return first.v
  if (time >= last.t) return last.v

  let index = 0
  while (index < keys.length - 2 && time > keys[index + 1].t) index += 1

  const k0 = keys[index]
  const k1 = keys[index + 1]
  const h = k1.t - k0.t
  if (h <= 0) return k1.v

  const s = (time - k0.t) / h
  const prev = keys[index - 1] ?? k0
  const next = keys[index + 2] ?? k1
  const m0 = (k1.v - prev.v) / (k1.t - prev.t || 1)
  const m1 = (next.v - k0.v) / (next.t - k0.t || 1)

  const s2 = s * s
  const s3 = s2 * s
  const value =
    (2 * s3 - 3 * s2 + 1) * k0.v +
    (s3 - 2 * s2 + s) * h * m0 +
    (-2 * s3 + 3 * s2) * k1.v +
    (s3 - s2) * h * m1

  const low = Math.min(k0.v, k1.v)
  const high = Math.max(k0.v, k1.v)
  return Math.min(Math.max(value, low), high)
}

/** 给定时刻的飞行进度，触地后恒为 1 */
export function flightProgressAt(time: number): number {
  return evalProgress(PROGRESS_KEYS, clamp(time, 0, REPLAY_DURATION))
}

interface Flight {
  dir: { x: number; z: number }
  start: Vec3
  landing: Vec3
  /** 跨网抬升量，保证常规跨网路径过网净高 */
  lift: number
}

function buildFlight(input: ReplayInput): Flight {
  const horizontal = Math.hypot(input.direction.x, input.direction.z)
  const dir =
    horizontal < 1e-9
      ? { x: 0, z: 1 }
      : { x: input.direction.x / horizontal, z: input.direction.z / horizontal }

  const landing: Vec3 = { x: input.landing.x, y: 0, z: input.landing.z }
  const start: Vec3 = {
    x: landing.x - dir.x * FLIGHT_LENGTH,
    y: LAUNCH_HEIGHT,
    z: landing.z - dir.z * FLIGHT_LENGTH,
  }

  let lift = 0
  const crossesNet = start.z * landing.z < 0
  if (crossesNet) {
    const crossing = clamp(-start.z / (landing.z - start.z), 0, 1)
    const baseHeight = LAUNCH_HEIGHT * (1 - crossing)
    const sine = Math.sin(Math.PI * crossing)
    if (sine > 1e-6 && baseHeight < NET_CROSSING_HEIGHT) {
      lift = (NET_CROSSING_HEIGHT - baseHeight) / sine
    }
    lift = Math.min(lift, MAX_FLIGHT_HEIGHT - LAUNCH_HEIGHT)
  }

  return { dir, start, landing, lift }
}

/** 球托底端在给定飞行进度处的位置；u = 1 时精确等于落点圆心 */
function ballPositionAt(flight: Flight, progress: number): Vec3 {
  const u = clamp(progress, 0, 1)
  if (u >= 1) return { ...flight.landing }
  return {
    x: flight.start.x + (flight.landing.x - flight.start.x) * u,
    y: LAUNCH_HEIGHT * (1 - u) + flight.lift * Math.sin(Math.PI * u),
    z: flight.start.z + (flight.landing.z - flight.start.z) * u,
  }
}

/** 解析切线，非零；接近触地时仍保持向下的分量 */
function ballForwardAt(flight: Flight, progress: number): Vec3 {
  const u = clamp(progress, 0, 0.999999)
  const tangent: Vec3 = {
    x: flight.landing.x - flight.start.x,
    y: -LAUNCH_HEIGHT + flight.lift * Math.PI * Math.cos(Math.PI * u),
    z: flight.landing.z - flight.start.z,
  }
  const unit = normalize(tangent)
  return unit.x === 0 && unit.y === 0 && unit.z === 0
    ? { x: flight.dir.x, y: 0, z: flight.dir.z }
    : unit
}

interface CameraKey {
  t: number
  position: Vec3
  target: Vec3
  fov: number
}

function hermite(a: Vec3, b: Vec3, ma: Vec3, mb: Vec3, h: number, s: number): Vec3 {
  const s2 = s * s
  const s3 = s2 * s
  const c0 = 2 * s3 - 3 * s2 + 1
  const c1 = s3 - 2 * s2 + s
  const c2 = -2 * s3 + 3 * s2
  const c3 = s3 - s2
  return {
    x: c0 * a.x + c1 * h * ma.x + c2 * b.x + c3 * h * mb.x,
    y: c0 * a.y + c1 * h * ma.y + c2 * b.y + c3 * h * mb.y,
    z: c0 * a.z + c1 * h * ma.z + c2 * b.z + c3 * h * mb.z,
  }
}

function hermiteNumber(a: number, b: number, ma: number, mb: number, h: number, s: number): number {
  const s2 = s * s
  const s3 = s2 * s
  return (
    (2 * s3 - 3 * s2 + 1) * a +
    (s3 - 2 * s2 + s) * h * ma +
    (-2 * s3 + 3 * s2) * b +
    (s3 - s2) * h * mb
  )
}

function slope(a: number, b: number, ta: number, tb: number): number {
  return tb > ta ? (b - a) / (tb - ta) : 0
}

function slopeVec(a: Vec3, b: Vec3, ta: number, tb: number): Vec3 {
  return tb > ta ? scale(sub(b, a), 1 / (tb - ta)) : { x: 0, y: 0, z: 0 }
}

const FOLLOW_FOV = 34

/**
 * 跟随段的相对机位：相对球体固定，整段里球在画面中的位置不变，
 * 只有球飞过时带出的球场、网与边线在变。
 */
function followPose(ball: Vec3, flight: Flight): { position: Vec3; target: Vec3 } {
  const dir = flight.dir
  const perp = { x: -dir.z, z: dir.x }
  return {
    position: {
      x: ball.x - dir.x * 2.7 + perp.x * 2.0,
      y: ball.y + 1.55,
      z: ball.z - dir.z * 2.7 + perp.z * 2.0,
    },
    target: {
      x: ball.x + dir.x * 0.5,
      y: ball.y - 0.35,
      z: ball.z + dir.z * 0.5,
    },
  }
}

/**
 * 四段分镜的相机关键帧。关键帧由落点与方向解析决定，段边界处位姿完全共享，
 * 之间用三次 Hermite 过渡，位置、视点与 FOV 都连续。
 */
function buildCameraKeys(flight: Flight): CameraKey[] {
  const dir = flight.dir
  const perp = { x: -dir.z, z: dir.x }
  const landing = flight.landing

  const place = (forward: number, side: number, height: number): Vec3 => ({
    x: landing.x - dir.x * forward + perp.x * side,
    y: height,
    z: landing.z - dir.z * forward + perp.z * side,
  })

  const followBall = ballPositionAt(flight, flightProgressAt(OVERVIEW_END))
  const slowBall = ballPositionAt(flight, flightProgressAt(FOLLOW_END))

  return [
    {
      t: 0,
      // 高角度俯瞰：站在来球一侧后方，整片球场与球网都收进画面
      position: {
        x: -dir.x * 15 + perp.x * 0.8,
        y: 10.5,
        z: -dir.z * 15 + perp.z * 0.8,
      },
      target: { x: 0, y: 0.2, z: 0 },
      fov: 50,
    },
    {
      t: OVERVIEW_END,
      ...followPose(followBall, flight),
      fov: FOLLOW_FOV,
    },
    {
      t: FOLLOW_END,
      ...followPose(slowBall, flight),
      fov: FOLLOW_FOV,
    },
    {
      t: SLOW_MO_END,
      // 贴地近景：压到白线尺度，圆形印记与线条同屏
      position: place(0.72, 0.55, 0.42),
      target: { x: landing.x, y: 0.012, z: landing.z },
      fov: 26,
    },
    {
      t: REPLAY_DURATION,
      position: place(0.55, 0.42, 0.36),
      target: { x: landing.x, y: 0.012, z: landing.z },
      fov: 24,
    },
  ]
}

function cameraAt(keys: CameraKey[], time: number): CameraKey {
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (time <= first.t) return first
  if (time >= last.t) return last

  let index = 0
  while (index < keys.length - 2 && time > keys[index + 1].t) index += 1

  const k0 = keys[index]
  const k1 = keys[index + 1]
  const h = k1.t - k0.t
  if (h <= 0) return k1

  const s = (time - k0.t) / h
  const prev = keys[index - 1] ?? k0
  const next = keys[index + 2] ?? k1

  const m0 = slopeVec(prev.position, k1.position, prev.t, k1.t)
  const m1 = slopeVec(k0.position, next.position, k0.t, next.t)
  const t0 = slopeVec(prev.target, k1.target, prev.t, k1.t)
  const t1 = slopeVec(k0.target, next.target, k0.t, next.t)

  return {
    t: time,
    position: hermite(k0.position, k1.position, m0, m1, h, s),
    target: hermite(k0.target, k1.target, t0, t1, h, s),
    fov: hermiteNumber(
      k0.fov,
      k1.fov,
      slope(prev.fov, k1.fov, prev.t, k1.t),
      slope(k0.fov, next.fov, k0.t, next.t),
      h,
      s,
    ),
  }
}

function segmentAt(time: number): ReplaySegment {
  if (time < OVERVIEW_END) return 'overview'
  if (time < FOLLOW_END) return 'follow'
  if (time < SLOW_MO_END) return 'slowmo'
  return 'result'
}

/** 计算给定输入与时刻的完整回放状态；纯函数，同一输入同一时刻逐字段相等 */
export function evaluateReplay(input: ReplayInput, time: number): ReplayFrame {
  const clampedTime = clamp(time, 0, REPLAY_DURATION)
  const flight = buildFlight(input)
  const progress = flightProgressAt(clampedTime)
  const cameraKeys = buildCameraKeys(flight)
  const view = cameraAt(cameraKeys, clampedTime)

  const landed = clampedTime >= CONTACT_TIME
  const position = landed ? { ...flight.landing } : ballPositionAt(flight, progress)
  const forward = landed
    ? ballForwardAt(flight, 1)
    : ballForwardAt(flight, progress)

  const ballOpacity = landed
    ? 1 - smoothStep((clampedTime - BALL_FADE_START) / (BALL_FADE_END - BALL_FADE_START))
    : 1
  const markerOpacity = smoothStep(
    (clampedTime - MARKER_FADE_START) / (MARKER_FADE_END - MARKER_FADE_START),
  )
  const resultOpacity = smoothStep(
    (clampedTime - RESULT_FADE_START) / (RESULT_FADE_END - RESULT_FADE_START),
  )

  return {
    time: clampedTime,
    flightProgress: progress,
    segment: segmentAt(clampedTime),
    ball: {
      position,
      forward,
      opacity: ballOpacity,
    },
    marker: {
      center: { x: input.landing.x, y: 0, z: input.landing.z },
      radius: CONTACT_RADIUS,
      opacity: markerOpacity,
    },
    camera: {
      position: view.position,
      target: view.target,
      fov: view.fov,
    },
    verdict: isInsideCourt(input.landing, input.format) ? 'IN' : 'OUT',
    resultOpacity,
  }
}

/** 结果牌与印记的静态信息，不随时间变化，便于渲染层一次性构建 */
export function replayVerdict(input: ReplayInput): 'IN' | 'OUT' {
  return isInsideCourt(input.landing, input.format) ? 'IN' : 'OUT'
}

/** 供 UI 识别输入变化的稳定键；数值相同即同一回放 */
export function replayInputKey(input: ReplayInput | null): string {
  if (!input) return 'none'
  return [input.format, input.landing.x, input.landing.z, input.direction.x, input.direction.z].join('|')
}

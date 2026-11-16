import { CONTACT_RADIUS, COURT, LINE, VALID_AREA } from './court'
import type { GroundPoint, MatchFormat } from './court'
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

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function lerpVec(a: Vec3, b: Vec3, k: number): Vec3 {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }
}

function unitGround(x: number, z: number): GroundPoint {
  const length = Math.hypot(x, z)
  if (length < 1e-9) return { x: 0, z: 1 }
  return { x: x / length, z: z / length }
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

/** 近景构图的垂直视场角；FOV 固定，用机位距离适配不同落点位置 */
const FRAMING_FOV = 30
/** 构图要求覆盖的边界线长度（米），沿边界线以落点为中心量取 */
const LINE_CONTEXT = 0.42
/** 落到边线附近（向内或向外）多少米内视为需要该线入画 */
const LINE_NEAR = 1.2
/** 16:9 画面里构图点允许出现的范围，避开结果牌占据的底部 */
const FRAME_LIMIT_X = 0.74
const FRAME_LIMIT_TOP = 0.66
const FRAME_LIMIT_BOTTOM = -0.6
/** 落点自身留在画面中部，近景不把落点顶到边缘 */
const CONTACT_LIMIT_X = 0.4
const CONTACT_LIMIT_TOP = 0.3
const CONTACT_LIMIT_BOTTOM = -0.45
const FRAME_ASPECT = 16 / 9
/** 机位高度随水平距离抬升，近景也是 55°–70° 的俯角，画面以地面为主 */
const FRAMING_HEIGHT_BASE = 0.4
const FRAMING_HEIGHT_PER_M = 1.5
const FRAMING_HEIGHT_MIN = 1.1
const FRAMING_HEIGHT_MAX = 7
/** 近景机位允许的最近距离；再近就只能看到一小块地面 */
const FRAMING_DISTANCE_MIN = 1.0
/** 视点从落点向场内偏移，落点抬到画面上半部，下半部留给球场 */
const FRAMING_TARGET_SHIFT = 0.2

interface FramingSegment {
  a: GroundPoint
  b: GroundPoint
}

interface FramingPlan {
  /** 由有效区域指向场外的单位法线；机位放在这一侧，场地面向镜头 */
  outward: GroundPoint
  /** 需要入画的边界线带 */
  segments: FramingSegment[]
}

function sidelineSegment(x: number, z: number, span: number): FramingSegment {
  const halfLength = COURT.halfLength
  return {
    a: { x, z: clamp(z - span, -halfLength, halfLength) },
    b: { x, z: clamp(z + span, -halfLength, halfLength) },
  }
}

function endlineSegment(x: number, z: number, span: number): FramingSegment {
  const halfWidth = COURT.doublesHalfWidth
  return {
    a: { x: clamp(x - span, -halfWidth, halfWidth), z },
    b: { x: clamp(x + span, -halfWidth, halfWidth), z },
  }
}

/** 深界内时用来做参照的一条场内线；不参与判定，只用于构图 */
interface ReferenceLine {
  a: GroundPoint
  b: GroundPoint
  /** true 表示线沿 x 轴走向（z 固定） */
  horizontal: boolean
  coordinate: number
}

/** 球场上的全部白线，按当前赛制的有效边界取边线位置 */
function paintedLines(format: MatchFormat): ReferenceLine[] {
  const { halfWidth, halfLength } = VALID_AREA[format]
  const halfCourtWidth = COURT.doublesHalfWidth
  const lines: ReferenceLine[] = []
  for (const sign of [-1, 1]) {
    const x = sign * halfWidth
    lines.push({
      a: { x, z: -halfLength },
      b: { x, z: halfLength },
      horizontal: false,
      coordinate: x,
    })
    const z = sign * halfLength
    lines.push({
      a: { x: -halfCourtWidth, z },
      b: { x: halfCourtWidth, z },
      horizontal: true,
      coordinate: z,
    })
    for (const serviceZ of [LINE.shortServiceLineZ, LINE.doublesLongServiceLineZ]) {
      lines.push({
        a: { x: -halfCourtWidth, z: sign * serviceZ },
        b: { x: halfCourtWidth, z: sign * serviceZ },
        horizontal: true,
        coordinate: sign * serviceZ,
      })
    }
    // 中线：前发球线到端线
    lines.push({
      a: { x: 0, z: sign * LINE.shortServiceLineZ },
      b: { x: 0, z: sign * LINE.endLineZ },
      horizontal: false,
      coordinate: 0,
    })
  }
  return lines
}

/**
 * 深界内落点：挑一条位于球飞行前方、离落点最近的场内白线作参照。
 * 机位留在来球一侧，跟随段收尾后直接压低靠近，不做绕场大回环。
 */
function nearestLinePlan(
  landing: GroundPoint,
  format: MatchFormat,
  dir: GroundPoint,
): FramingPlan {
  const lines = paintedLines(format)
  let best: ReferenceLine | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const dx = line.b.x - line.a.x
    const dz = line.b.z - line.a.z
    const lengthSq = dx * dx + dz * dz
    const t =
      lengthSq < 1e-12
        ? 0
        : clamp(((landing.x - line.a.x) * dx + (landing.z - line.a.z) * dz) / lengthSq, 0, 1)
    const nearest = { x: line.a.x + dx * t, z: line.a.z + dz * t }
    // 只取落点前方（以球飞行方向计）不远的线，落在身后的线压不进近景
    if ((nearest.x - landing.x) * dir.x + (nearest.z - landing.z) * dir.z > 0.35) continue
    const distance = Math.hypot(landing.x - nearest.x, landing.z - nearest.z)
    if (distance < bestDistance - 1e-9) {
      best = line
      bestDistance = distance
    }
  }

  const line = best ?? lines[0]
  const span = 1.1
  const segment: FramingSegment = line.horizontal
    ? {
        a: { x: clamp(landing.x - span, line.a.x, line.b.x), z: line.coordinate },
        b: { x: clamp(landing.x + span, line.a.x, line.b.x), z: line.coordinate },
      }
    : {
        a: { x: line.coordinate, z: clamp(landing.z - span, line.a.z, line.b.z) },
        b: { x: line.coordinate, z: clamp(landing.z + span, line.a.z, line.b.z) },
      }

  return { outward: { x: -dir.x, z: -dir.z }, segments: [segment] }
}

/**
 * 挑选近景需要交代的参照线：压边线看该条边线，压角看两条线，明显界内或界外
 * 至少带上最近的一条有效边界。单打只用单打边线，不把旁边的双打线当有效边界。
 */
function framingPlan(landing: GroundPoint, format: MatchFormat, dir: GroundPoint): FramingPlan {
  const { halfWidth, halfLength } = VALID_AREA[format]
  const signX = landing.x >= 0 ? 1 : -1
  const signZ = landing.z >= 0 ? 1 : -1
  const nearSide = Math.abs(landing.x) - halfWidth > -LINE_NEAR
  const nearEnd = Math.abs(landing.z) - halfLength > -LINE_NEAR
  const sideLine = () => sidelineSegment(signX * halfWidth, landing.z, LINE_CONTEXT)
  const endLine = () => endlineSegment(landing.x, signZ * halfLength, LINE_CONTEXT)

  if (nearSide && nearEnd) {
    return { outward: unitGround(signX, signZ), segments: [sideLine(), endLine()] }
  }
  if (nearSide) {
    return { outward: { x: signX, z: 0 }, segments: [sideLine()] }
  }
  if (nearEnd) {
    return { outward: { x: 0, z: signZ }, segments: [endLine()] }
  }
  return nearestLinePlan(landing, format, dir)
}

/**
 * 视线方向：机位压在边界线外侧，向场内看落点与线带，画面主体是球场，
 * 场外只占镜头前的一窄条。斜角取向来球一侧，延续跟随段的飞行方向。
 */
function framingDirection(plan: FramingPlan, flight: Flight): GroundPoint {
  const outward = plan.outward
  let tangent = { x: -outward.z, z: outward.x }
  if (tangent.x * flight.dir.x + tangent.z * flight.dir.z < 0) {
    tangent = { x: -tangent.x, z: -tangent.z }
  }
  return unitGround(outward.x * 0.9 + tangent.x * 0.42, outward.z * 0.9 + tangent.z * 0.42)
}

/** 构图采样点：落点圆心，以及每条线带上等距的五个点 */
function focusPoints(landing: GroundPoint, plan: FramingPlan): GroundPoint[] {
  const points: GroundPoint[] = [{ x: landing.x, z: landing.z }]
  for (const segment of plan.segments) {
    for (let index = 0; index <= 4; index += 1) {
      const k = index / 4
      points.push({
        x: segment.a.x + (segment.b.x - segment.a.x) * k,
        z: segment.a.z + (segment.b.z - segment.a.z) * k,
      })
    }
  }
  return points
}

/** 地面点在给定机位下的归一化画面坐标；深度为负时返回 null */
function projectGround(
  position: Vec3,
  target: Vec3,
  fov: number,
  point: GroundPoint,
): { x: number; y: number } | null {
  const forward = normalize(sub(target, position))
  if (forward.x === 0 && forward.y === 0 && forward.z === 0) return null
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }))
  const up = cross(right, forward)
  const rel = { x: point.x - position.x, y: 0 - position.y, z: point.z - position.z }
  const depth = dot(rel, forward)
  if (depth < 0.2) return null
  const tan = Math.tan((fov * Math.PI) / 360)
  return {
    x: dot(rel, right) / (depth * tan * FRAME_ASPECT),
    y: dot(rel, up) / (depth * tan),
  }
}

/** 机位不得停在网面附近；球网占据 z=0、|x| ≤ 3.05、0.76–1.55 m 的范围 */
const NET_CLEARANCE_Z = 0.55
const NET_CLEARANCE_Y = COURT.netPostHeight + 0.14

function nearNet(position: Vec3): boolean {
  return (
    Math.abs(position.z) < NET_CLEARANCE_Z &&
    Math.abs(position.x) < COURT.doublesHalfWidth + 0.2 &&
    position.y < NET_CLEARANCE_Y
  )
}

/**
 * 由落点反解近景机位：固定 FOV 与机位方向，从近到远找能把落点与所需线带
 * 都收进安全范围内的最小距离，避免手动调参在四边四角间顾此失彼。
 */
function framingPose(landing: GroundPoint, plan: FramingPlan, flight: Flight): CameraKey {
  const direction = framingDirection(plan, flight)
  const target: Vec3 = {
    x: landing.x - plan.outward.x * FRAMING_TARGET_SHIFT,
    y: 0.02,
    z: landing.z - plan.outward.z * FRAMING_TARGET_SHIFT,
  }
  const points = focusPoints(landing, plan)

  const poseAt = (distance: number): CameraKey => ({
    t: 0,
    position: {
      x: landing.x - direction.x * distance,
      y: clamp(
        FRAMING_HEIGHT_BASE + distance * FRAMING_HEIGHT_PER_M,
        FRAMING_HEIGHT_MIN,
        FRAMING_HEIGHT_MAX,
      ),
      z: landing.z - direction.z * distance,
    },
    target,
    fov: FRAMING_FOV,
  })

  const fits = (pose: CameraKey): boolean => {
    if (nearNet(pose.position)) return false
    const contact = projectGround(pose.position, pose.target, pose.fov, landing)
    if (
      !contact ||
      Math.abs(contact.x) > CONTACT_LIMIT_X ||
      contact.y > CONTACT_LIMIT_TOP ||
      contact.y < CONTACT_LIMIT_BOTTOM
    ) {
      return false
    }
    return points.every((point) => {
      const ndc = projectGround(pose.position, pose.target, pose.fov, point)
      if (!ndc) return false
      return (
        Math.abs(ndc.x) <= FRAME_LIMIT_X &&
        ndc.y <= FRAME_LIMIT_TOP &&
        ndc.y >= FRAME_LIMIT_BOTTOM
      )
    })
  }

  // 低机位不越过球网：停在落点同一侧，避免网面糊在镜头前
  const crossingDistance = (Math.abs(landing.z) - 0.35) / Math.max(Math.abs(direction.z), 1e-6)
  const staysSameSide = direction.z * landing.z > 0
  const maxDistance = staysSameSide
    ? clamp(crossingDistance, FRAMING_DISTANCE_MIN, 9)
    : 9

  for (let distance = FRAMING_DISTANCE_MIN; distance <= maxDistance + 1e-9; distance += 0.02) {
    const pose = poseAt(distance)
    if (fits(pose)) return pose
  }
  return poseAt(maxDistance)
}

/** 跟随段结束到近景之间越过网面时，抬出一个过网机位，避免镜头穿过球网 */
function netGuardKey(from: CameraKey, to: CameraKey): CameraKey | null {
  if (from.position.z * to.position.z >= 0) return null
  const k = from.position.z / (from.position.z - to.position.z)
  const crossingX = from.position.x + (to.position.x - from.position.x) * k
  if (Math.abs(crossingX) > COURT.doublesHalfWidth + 0.2) return null
  const crossingY = from.position.y + (to.position.y - from.position.y) * k
  if (crossingY > COURT.netPostHeight + 0.08) return null
  if (crossingY < 0.62) return null

  return {
    t: from.t + (to.t - from.t) * clamp(k, 0.2, 0.8),
    position: { x: crossingX, y: COURT.netPostHeight + 0.55, z: 0 },
    target: lerpVec(from.target, to.target, clamp(k, 0.2, 0.8)),
    fov: from.fov + (to.fov - from.fov) * clamp(k, 0.2, 0.8),
  }
}

function buildCameraKeys(flight: Flight, format: MatchFormat): CameraKey[] {
  const dir = flight.dir
  const perp = { x: -dir.z, z: dir.x }
  const landing = flight.landing

  const followBall = ballPositionAt(flight, flightProgressAt(OVERVIEW_END))
  const slowBall = ballPositionAt(flight, flightProgressAt(FOLLOW_END))

  const followEnd: CameraKey = {
    t: FOLLOW_END,
    ...followPose(slowBall, flight),
    fov: FOLLOW_FOV,
  }
  const framing = framingPose(landing, framingPlan(landing, format, dir), flight)
  const contact: CameraKey = { ...framing, t: CONTACT_TIME }
  // 定格只做小幅前推：沿原视线靠近落点，视点与 FOV 几乎不动
  const pushIn = 0.055
  const pushed = lerpVec(contact.position, contact.target, pushIn)
  const result: CameraKey = {
    t: REPLAY_DURATION,
    position: nearNet(pushed) ? contact.position : pushed,
    target: contact.target,
    fov: FRAMING_FOV - 1,
  }

  const keys: CameraKey[] = [
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
    followEnd,
  ]

  const guard = netGuardKey(followEnd, contact)
  if (guard) keys.push(guard)
  keys.push(contact)
  keys.push({
    t: SLOW_MO_END,
    position: contact.position,
    target: contact.target,
    fov: contact.fov,
  })
  keys.push(result)
  return keys
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
  const cameraKeys = buildCameraKeys(flight, input.format)
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

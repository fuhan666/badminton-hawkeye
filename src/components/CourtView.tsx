import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { CONTACT_RADIUS } from '../domain/court'
import type { GroundPoint, MatchFormat } from '../domain/court'
import { isNudgeKey, nudgePoint } from '../domain/editing'
import { resolveDirection } from '../domain/direction'
import { FULL_VIEW, toViewBoxString, zoomView } from '../domain/viewport'
import type { ViewBox } from '../domain/viewport'
import CourtGeometry from './CourtGeometry'

export type CourtViewVariant = 'full' | 'zoom'
export type EditTarget = 'landing' | 'incoming'

interface CourtViewProps {
  variant: CourtViewVariant
  format: MatchFormat
  landing: GroundPoint
  incoming: GroundPoint | null
  target: EditTarget
  onSelectTarget: (target: EditTarget) => void
  onChange: (target: EditTarget, point: GroundPoint) => void
}

/** 手柄半径仅用于点选，不参与判定；接触圆始终按真实半径绘制。 */
const HANDLE_RADIUS: Record<CourtViewVariant, number> = {
  full: 0.18,
  zoom: 0.03,
}

const LANDING_COLOR = '#facc15'
const INCOMING_COLOR = '#38bdf8'

function pointFromEvent(svg: SVGSVGElement, event: { clientX: number; clientY: number }) {
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(matrix.inverse())
  return { x: local.x, z: local.y }
}

export default function CourtView({
  variant,
  format,
  landing,
  incoming,
  target,
  onSelectTarget,
  onChange,
}: CourtViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragTarget = useRef<EditTarget | null>(null)
  // 局部视图拖动期间固定这次坐标变换，避免视窗跟随编辑点重居中造成跳动。
  const [frozenView, setFrozenView] = useState<ViewBox | null>(null)

  // 局部视图围绕当前编辑目标；来向点未设置时聚焦落点。
  const focus = target === 'incoming' && incoming ? incoming : landing
  const view = variant === 'full' ? FULL_VIEW : (frozenView ?? zoomView(focus))
  const handleRadius = HANDLE_RADIUS[variant]
  const direction = resolveDirection(landing, incoming)
  const coincident = direction.issue === 'coincident'
  const arrowId = `arrow-${variant}`
  // 局部窗口只有 0.24 m 宽，来向点不在窗口内时画线只剩噪声，故只在全场视图提示指向。
  const incomingInView =
    incoming !== null &&
    incoming.x >= view.minX &&
    incoming.x <= view.minX + view.width &&
    incoming.z >= view.minZ &&
    incoming.z <= view.minZ + view.height
  const showArrow = Boolean(direction.unit && incoming) && (variant === 'full' || incomingInView)

  function pointFor(t: EditTarget): GroundPoint | null {
    if (t === 'incoming') return incoming
    return landing
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg || event.button !== 0) return
    const point = pointFromEvent(svg, event)
    if (!point) return

    // 两点重叠时优先拖动当前编辑目标，否则就近抓取，避免拖错点或拖不开。
    // 来向点尚不存在时不抓取手柄，保证第一次点选是放置而不是拖动落点。
    const positions: { target: EditTarget; point: GroundPoint }[] = [
      { target: 'landing', point: landing },
    ]
    if (incoming) positions.push({ target: 'incoming', point: incoming })
    const candidates = positions.map((item) => ({
      target: item.target,
      distance: Math.hypot(point.x - item.point.x, point.z - item.point.z),
    }))
    const canGrab = !(target === 'incoming' && !incoming)
    const activeCandidate = candidates.find((item) => item.target === target)
    const nearest = candidates
      .slice()
      .sort((a, b) => a.distance - b.distance)
      .find((item) => item.distance <= handleRadius)
    const grabbed = !canGrab
      ? undefined
      : activeCandidate && activeCandidate.distance <= handleRadius
        ? activeCandidate
        : nearest

    const active = grabbed?.target ?? target
    if (grabbed && grabbed.target !== target) onSelectTarget(grabbed.target)
    if (variant === 'zoom') setFrozenView(zoomView(focus))
    if (!grabbed) onChange(active, point)

    dragTarget.current = active
    svg.setPointerCapture(event.pointerId)
    svg.focus({ preventScroll: true })
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    const active = dragTarget.current
    if (!svg || !active) return
    const point = pointFromEvent(svg, event)
    if (point) onChange(active, point)
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragTarget.current) return
    dragTarget.current = null
    setFrozenView(null)
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!isNudgeKey(event.key)) return
    // 只拦截编辑目标的方向键，避免滚动页面。
    const current = pointFor(target)
    if (!current) return
    event.preventDefault()
    onChange(target, nudgePoint(current, event.key, event.shiftKey))
  }

  return (
    <svg
      ref={svgRef}
      className={`court-view court-view--${variant}`}
      viewBox={toViewBoxString(view)}
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label={
        variant === 'full'
          ? '全场选点：点击放置当前目标，拖动黄色或蓝色手柄，方向键微调'
          : '局部精调：拖动当前目标手柄，方向键 1 毫米、Shift 10 毫米微调'
      }
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={4}
          markerHeight={4}
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={INCOMING_COLOR} />
        </marker>
      </defs>

      <CourtGeometry format={format}>
        <g pointerEvents="none">
          {showArrow && incoming ? (
            <line
              x1={landing.x}
              y1={landing.z}
              x2={incoming.x}
              y2={incoming.z}
              stroke={INCOMING_COLOR}
              strokeWidth={variant === 'full' ? 0.045 : 0.0045}
              strokeDasharray={variant === 'full' ? '0.14 0.08' : '0.018 0.012'}
              markerEnd={`url(#${arrowId})`}
            />
          ) : null}

          <circle
            data-role="contact"
            cx={landing.x}
            cy={landing.z}
            r={CONTACT_RADIUS}
            fill={LANDING_COLOR}
            stroke="#0b1a13"
            strokeWidth={0.003}
          />
          <circle
            data-role="landing-handle"
            cx={landing.x}
            cy={landing.z}
            r={handleRadius}
            fill="rgba(250, 204, 21, 0.16)"
            stroke={target === 'landing' ? LANDING_COLOR : 'rgba(250, 204, 21, 0.55)'}
            strokeWidth={variant === 'full' ? 0.012 : 0.0035}
            strokeDasharray={variant === 'full' ? '0.06 0.04' : '0.012 0.008'}
          />

          {incoming ? (
            <circle
              data-role="incoming-handle"
              cx={incoming.x}
              cy={incoming.z}
              r={handleRadius * 0.82}
              fill={coincident ? 'rgba(248, 113, 113, 0.25)' : 'rgba(56, 189, 248, 0.18)'}
              stroke={coincident ? '#f87171' : target === 'incoming' ? INCOMING_COLOR : 'rgba(56, 189, 248, 0.6)'}
              strokeWidth={variant === 'full' ? 0.012 : 0.0035}
              strokeDasharray={variant === 'full' ? '0.05 0.04' : '0.01 0.008'}
            />
          ) : null}
        </g>
      </CourtGeometry>
    </svg>
  )
}

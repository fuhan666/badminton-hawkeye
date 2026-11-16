import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CONTACT_RADIUS } from '../domain/court'
import type { GroundPoint, MatchFormat } from '../domain/court'
import { FULL_VIEW, toViewBoxString, zoomView } from '../domain/viewport'
import type { ViewBox } from '../domain/viewport'
import CourtGeometry from './CourtGeometry'

export type CourtViewVariant = 'full' | 'zoom'

interface CourtViewProps {
  variant: CourtViewVariant
  format: MatchFormat
  center: GroundPoint
  onChange: (point: GroundPoint) => void
}

/** 手柄半径仅用于点选，不参与判定；接触圆始终按真实半径绘制。 */
const HANDLE_RADIUS: Record<CourtViewVariant, number> = {
  full: 0.18,
  zoom: 0.03,
}

function pointFromEvent(svg: SVGSVGElement, event: ReactPointerEvent<SVGSVGElement>) {
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(matrix.inverse())
  return { x: local.x, z: local.y }
}

export default function CourtView({ variant, format, center, onChange }: CourtViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragging = useRef(false)
  // 局部视图拖动期间固定这次坐标变换，避免视窗跟随圆心重居中造成跳动。
  const [frozenView, setFrozenView] = useState<ViewBox | null>(null)

  const view = variant === 'full' ? FULL_VIEW : (frozenView ?? zoomView(center))
  const handleRadius = HANDLE_RADIUS[variant]

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg || event.button !== 0) return
    const point = pointFromEvent(svg, event)
    if (!point) return

    const grabbed =
      Math.hypot(point.x - center.x, point.z - center.z) <= handleRadius

    if (variant === 'zoom') setFrozenView(zoomView(center))
    if (!grabbed) onChange(point)

    dragging.current = true
    svg.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg || !dragging.current) return
    const point = pointFromEvent(svg, event)
    if (point) onChange(point)
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragging.current) return
    dragging.current = false
    setFrozenView(null)
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <svg
      ref={svgRef}
      className={`court-view court-view--${variant}`}
      viewBox={toViewBoxString(view)}
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label={variant === 'full' ? '全场选点' : '局部精调'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <CourtGeometry format={format}>
        <g pointerEvents="none">
          <circle
            cx={center.x}
            cy={center.z}
            r={CONTACT_RADIUS}
            fill="#facc15"
            stroke="#0b1a13"
            strokeWidth={0.003}
          />
          <circle
            cx={center.x}
            cy={center.z}
            r={handleRadius}
            fill="rgba(250, 204, 21, 0.16)"
            stroke="rgba(250, 204, 21, 0.95)"
            strokeWidth={variant === 'full' ? 0.01 : 0.003}
            strokeDasharray={variant === 'full' ? '0.06 0.04' : '0.012 0.008'}
          />
        </g>
      </CourtGeometry>
    </svg>
  )
}

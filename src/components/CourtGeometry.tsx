import type { ReactNode } from 'react'
import type { CourtPalette } from '../courtColors'
import { COURT, LINE, VALID_AREA } from '../domain/court'
import type { MatchFormat } from '../domain/court'

interface CourtGeometryProps {
  format: MatchFormat
  palette: CourtPalette
  children?: ReactNode
}

/**
 * 球场俯视图几何。全部使用米制坐标，y 轴对应 +z（向下）。
 * 描边一律以中心线为路径，线带宽 0.04 m 由 strokeWidth 居中展开。
 */
export default function CourtGeometry({ format, palette, children }: CourtGeometryProps) {
  const area = VALID_AREA[format]

  return (
    <g>
      {/* 球场面层，尺寸量至双打边线与端线外沿 */}
      <rect
        x={-COURT.doublesHalfWidth}
        y={-COURT.halfLength}
        width={COURT.doublesWidth}
        height={COURT.length}
        fill={palette.surface}
      />

      {/* 当前赛制的有效矩形 */}
      <rect
        x={-area.halfWidth}
        y={-area.halfLength}
        width={area.halfWidth * 2}
        height={area.halfLength * 2}
        fill={format === 'doubles' ? 'rgba(125, 211, 252, 0.10)' : 'rgba(253, 224, 71, 0.14)'}
        stroke="rgba(255, 255, 255, 0.45)"
        strokeWidth={0.015}
        strokeDasharray="0.12 0.09"
      />

      <g
        stroke={palette.editorLine}
        strokeWidth={COURT.lineWidth}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        fill="none"
      >
        {/* 双打边线 + 端线：外沿即有效边界 */}
        <rect
          x={-LINE.doublesSidelineX}
          y={-LINE.endLineZ}
          width={LINE.doublesSidelineX * 2}
          height={LINE.endLineZ * 2}
        />
        {/* 单打边线 */}
        <line x1={-LINE.singlesSidelineX} y1={-LINE.endLineZ} x2={-LINE.singlesSidelineX} y2={LINE.endLineZ} />
        <line x1={LINE.singlesSidelineX} y1={-LINE.endLineZ} x2={LINE.singlesSidelineX} y2={LINE.endLineZ} />
        {/* 前发球线 */}
        <line x1={-LINE.doublesSidelineX} y1={-LINE.shortServiceLineZ} x2={LINE.doublesSidelineX} y2={-LINE.shortServiceLineZ} />
        <line x1={-LINE.doublesSidelineX} y1={LINE.shortServiceLineZ} x2={LINE.doublesSidelineX} y2={LINE.shortServiceLineZ} />
        {/* 双打后发球线 */}
        <line x1={-LINE.doublesSidelineX} y1={-LINE.doublesLongServiceLineZ} x2={LINE.doublesSidelineX} y2={-LINE.doublesLongServiceLineZ} />
        <line x1={-LINE.doublesSidelineX} y1={LINE.doublesLongServiceLineZ} x2={LINE.doublesSidelineX} y2={LINE.doublesLongServiceLineZ} />
        {/* 中线：前发球线之间贯穿两端后发球区 */}
        <line x1={0} y1={LINE.shortServiceLineZ} x2={0} y2={LINE.endLineZ} />
        <line x1={0} y1={-LINE.shortServiceLineZ} x2={0} y2={-LINE.endLineZ} />
      </g>

      {/* 球网俯视示意：网面为细线，网柱立于双打边线外 */}
      <line
        x1={-COURT.doublesHalfWidth}
        y1={0}
        x2={COURT.doublesHalfWidth}
        y2={0}
        stroke="#cbd5e1"
        strokeWidth={0.018}
        strokeDasharray="0.06 0.04"
        strokeLinecap="butt"
      />
      {[-1, 1].map((sign) => (
        <circle
          key={sign}
          cx={sign * (COURT.doublesHalfWidth + 0.045)}
          cy={0}
          r={0.028}
          fill="#64748b"
          stroke="#e2e8f0"
          strokeWidth={0.008}
        />
      ))}

      {children}
    </g>
  )
}

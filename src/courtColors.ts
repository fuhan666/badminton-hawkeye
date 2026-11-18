export interface CourtPalette {
  surface: string
  editorSurround: string
  surround: string
  background: string
  line: string
  editorLine: string
  markerIn: string
  markerOut: string
  editorMarkerIn: string
  editorMarkerOut: string
  resultIn: string
  resultOut: string
  editorResultIn: string
  editorResultOut: string
}

const SHARED_COLORS = {
  line: '#f8fafc',
  editorLine: '#ffffff',
  markerIn: '#fbbf24',
  markerOut: '#f87171',
  editorMarkerIn: '#facc15',
  editorMarkerOut: '#facc15',
  resultIn: '#4ade80',
  resultOut: '#f87171',
  editorResultIn: '#15803d',
  editorResultOut: '#b91c1c',
}

export const COURT_COLORS = {
  green: {
    ...SHARED_COLORS,
    label: '绿色',
    surface: '#2f7d5e',
    editorSurround: '#0f2b24',
    surround: '#33574a',
    background: '#0d1a16',
  },
  blue: {
    ...SHARED_COLORS,
    label: '蓝色',
    surface: '#306a9e',
    editorSurround: '#142b40',
    surround: '#344c63',
    background: '#101923',
  },
  purple: {
    ...SHARED_COLORS,
    label: '紫色',
    surface: '#73549a',
    editorSurround: '#2a1d3c',
    surround: '#4c3c60',
    background: '#19121f',
  },
} satisfies Record<string, CourtPalette & { label: string }>

export type CourtColor = keyof typeof COURT_COLORS
export type PaletteMode = CourtColor | 'custom'
export const PALETTE_FIELDS = [
  { key: 'surface', label: '地胶' },
  { key: 'surround', label: '场外区域' },
  { key: 'background', label: '背景' },
  { key: 'line', label: '场线' },
  { key: 'markerIn', label: '界内印记' },
  { key: 'markerOut', label: '界外印记' },
  { key: 'resultIn', label: 'IN 结果' },
  { key: 'resultOut', label: 'OUT 结果' },
] as const
export type PaletteField = (typeof PALETTE_FIELDS)[number]['key']

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export function isCourtPalette(value: unknown): value is CourtPalette {
  if (!value || typeof value !== 'object') return false
  return Object.keys(COURT_COLORS.green).filter((key) => key !== 'label')
    .every((key) => isHexColor((value as Record<string, unknown>)[key]))
}

export function updatePalette(palette: CourtPalette, key: PaletteField, color: string): CourtPalette {
  const next = { ...palette, [key]: color }
  if (key === 'surround') next.editorSurround = color
  if (key === 'line') next.editorLine = color
  if (key === 'markerIn') next.editorMarkerIn = color
  if (key === 'markerOut') next.editorMarkerOut = color
  if (key === 'resultIn') next.editorResultIn = color
  if (key === 'resultOut') next.editorResultOut = color
  return next
}

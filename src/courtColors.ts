export const COURT_COLORS = {
  green: {
    label: '绿色',
    surface: '#2f7d5e',
    editorSurround: '#0f2b24',
    surround: '#33574a',
    background: '#0d1a16',
  },
  blue: {
    label: '蓝色',
    surface: '#306a9e',
    editorSurround: '#142b40',
    surround: '#344c63',
    background: '#101923',
  },
  purple: {
    label: '紫色',
    surface: '#73549a',
    editorSurround: '#2a1d3c',
    surround: '#4c3c60',
    background: '#19121f',
  },
} as const

export type CourtColor = keyof typeof COURT_COLORS

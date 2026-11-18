import { COURT_COLORS, isCourtPalette } from '../courtColors'
import type { CourtPalette, PaletteMode } from '../courtColors'
import { DEFAULT_EXPORT_SETTINGS, isExportSettings } from '../export/exportSettings'
import type { ExportSettings } from '../export/exportSettings'

export const SETTINGS_KEY = 'badminton-hawkeye.settings'

export interface AppSettings {
  export: ExportSettings
  paletteMode: PaletteMode
  customPalette: CourtPalette | null
}

export function defaultSettings(): AppSettings {
  return { export: { ...DEFAULT_EXPORT_SETTINGS }, paletteMode: 'green', customPalette: null }
}

export function readSettings(storage: Pick<Storage, 'getItem'>): AppSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (raw === null) return defaultSettings()
    const value = JSON.parse(raw) as AppSettings
    const validMode = value && (value.paletteMode === 'custom' || Object.hasOwn(COURT_COLORS, value.paletteMode))
    if (validMode && isExportSettings(value.export) &&
      (value.customPalette === null || isCourtPalette(value.customPalette)) &&
      (value.paletteMode !== 'custom' || value.customPalette !== null)) return value
  } catch {
    // 无法读取或数据损坏时，按产品要求静默重置。
  }
  return defaultSettings()
}

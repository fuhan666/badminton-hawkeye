export const EXPORT_FPS_OPTIONS = [24, 25, 30, 50, 60] as const
export type ExportFps = (typeof EXPORT_FPS_OPTIONS)[number]

export interface ExportSettings {
  width: number
  height: number
  fps: ExportFps
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { width: 1920, height: 1080, fps: 30 }

export const RESOLUTION_PRESETS = [
  { group: '横屏', label: '720p', width: 1280, height: 720 },
  { group: '横屏', label: '1080p', width: 1920, height: 1080 },
  { group: '横屏', label: '1440p', width: 2560, height: 1440 },
  { group: '横屏', label: '4K', width: 3840, height: 2160 },
  { group: '竖屏', label: '720p', width: 720, height: 1280 },
  { group: '竖屏', label: '1080p', width: 1080, height: 1920 },
  { group: '竖屏', label: '1440p', width: 1440, height: 2560 },
  { group: '竖屏', label: '4K', width: 2160, height: 3840 },
  { group: '手机长屏', label: '1080 × 2400', width: 1080, height: 2400 },
] as const

export function isExportSettings(value: unknown): value is ExportSettings {
  if (!value || typeof value !== 'object') return false
  const { width, height, fps } = value as ExportSettings
  return Number.isSafeInteger(width) && width > 0 && width % 2 === 0 &&
    Number.isSafeInteger(height) && height > 0 && height % 2 === 0 &&
    EXPORT_FPS_OPTIONS.includes(fps)
}

// H.264 Annex A：level、MaxFS、MaxMBPS、Baseline 最大码率（Mbps）。
const AVC_LEVELS = [
  [30, 1620, 40500, 10],
  [31, 3600, 108000, 14],
  [32, 5120, 216000, 20],
  [40, 8192, 245760, 20],
  [41, 8192, 245760, 50],
  [42, 8704, 522240, 50],
  [50, 22080, 589824, 135],
  [51, 36864, 983040, 240],
  [52, 36864, 2073600, 240],
  [60, 139264, 4177920, 240],
  [61, 139264, 8355840, 480],
  [62, 139264, 16711680, 800],
] as const

export function buildEncoderConfig(settings: ExportSettings): VideoEncoderConfig {
  if (!isExportSettings(settings)) throw new Error('宽高须为正偶数整数，帧率须为 24、25、30、50 或 60 fps。')
  const { width, height, fps } = settings
  const mbWidth = Math.ceil(width / 16)
  const mbHeight = Math.ceil(height / 16)
  const blocks = mbWidth * mbHeight
  const bitrate = Math.round(8_000_000 * (width * height / (1920 * 1080)) * (fps / 30))
  const level = AVC_LEVELS.find(([, maxFs, maxMbps, maxBitrate]) =>
    blocks <= maxFs && blocks * fps <= maxMbps && bitrate <= maxBitrate * 1_000_000 &&
    Math.max(mbWidth, mbHeight) <= Math.floor(Math.sqrt(maxFs * 8)),
  )
  if (!level) throw new Error(`${width}×${height} / ${fps} fps 超出 H.264 编码范围。`)
  return {
    codec: `avc1.4200${level[0].toString(16).padStart(2, '0')}`,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  }
}

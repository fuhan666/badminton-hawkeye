import { describe, expect, it } from 'vitest'
import { buildEncoderConfig, DEFAULT_EXPORT_SETTINGS, isExportSettings, RESOLUTION_PRESETS, EXPORT_FPS_OPTIONS } from './exportSettings'

describe('导出参数', () => {
  it('拒绝空值、奇数、零、负数、小数和未知帧率', () => {
    for (const width of [0, -2, 1921, 2.5, NaN, Infinity, '1920', undefined]) {
      expect(isExportSettings({ ...DEFAULT_EXPORT_SETTINGS, width })).toBe(false)
    }
    expect(isExportSettings({ ...DEFAULT_EXPORT_SETTINGS, height: 721 })).toBe(false)
    expect(isExportSettings({ ...DEFAULT_EXPORT_SETTINGS, fps: 120 })).toBe(false)
    expect(isExportSettings(null)).toBe(false)
  })

  it('支持全部预设和帧率，横竖转置的编码等级相同', () => {
    for (const preset of RESOLUTION_PRESETS) for (const fps of EXPORT_FPS_OPTIONS) {
      const config = buildEncoderConfig({ ...preset, fps })
      expect(config.width).toBe(preset.width)
      expect(config.framerate).toBe(fps)
      expect(config.codec).toBe(buildEncoderConfig({ width: preset.height, height: preset.width, fps }).codec)
    }
  })

  it('按实际宏块率选择 1080p30、1080p60、4K30 和 4K60 等级', () => {
    expect(buildEncoderConfig(DEFAULT_EXPORT_SETTINGS)).toMatchObject({ codec: 'avc1.420028', bitrate: 8_000_000 })
    expect(buildEncoderConfig({ width: 1920, height: 1080, fps: 60 }).codec).toBe('avc1.42002a')
    expect(buildEncoderConfig({ width: 3840, height: 2160, fps: 30 }).codec).toBe('avc1.420033')
    expect(buildEncoderConfig({ width: 3840, height: 2160, fps: 60 })).toMatchObject({ codec: 'avc1.420034', bitrate: 64_000_000 })
  })

  it('拒绝 H.264 不能表示的尺寸和超长单边尺寸', () => {
    expect(() => buildEncoderConfig({ width: 100000, height: 100000, fps: 30 })).toThrow('超出 H.264')
    expect(() => buildEncoderConfig({ width: 100000, height: 2, fps: 30 })).toThrow('超出 H.264')
  })
})

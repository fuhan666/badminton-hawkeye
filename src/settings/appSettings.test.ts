import { describe, expect, it } from 'vitest'
import { COURT_COLORS, updatePalette } from '../courtColors'
import { defaultSettings, readSettings } from './appSettings'

describe('浏览器配置', () => {
  it('首次访问和读取失败时静默恢复默认', () => {
    expect(readSettings({ getItem: () => null })).toEqual(defaultSettings())
    expect(readSettings({ getItem: () => { throw new Error('blocked') } })).toEqual(defaultSettings())
  })

  it('JSON 或配置损坏时重置整份设置', () => {
    for (const value of ['{', 'null', '{}', JSON.stringify({ ...defaultSettings(), paletteMode: 'unknown' }), JSON.stringify({ ...defaultSettings(), paletteMode: 'custom' }), JSON.stringify({ ...defaultSettings(), export: { width: 3, height: 1080, fps: 30 } })]) {
      expect(readSettings({ getItem: () => value })).toEqual(defaultSettings())
    }
  })

  it('完整恢复自定义颜色、竖屏尺寸与帧率', () => {
    const value = { export: { width: 1080, height: 2400, fps: 60 }, paletteMode: 'custom', customPalette: updatePalette(COURT_COLORS.blue, 'resultIn', '#123456') }
    expect(readSettings({ getItem: () => JSON.stringify(value) })).toEqual(value)
    expect(value.customPalette.editorResultIn).toBe('#123456')
    expect(COURT_COLORS.blue.resultIn).toBe('#4ade80')
  })

  it('同一用途更新二维与三维颜色，不修改其它用途', () => {
    const palette = updatePalette(COURT_COLORS.green, 'surround', '#112233')
    expect(palette.editorSurround).toBe('#112233')
    expect(palette.surround).toBe('#112233')
    expect(palette.surface).toBe(COURT_COLORS.green.surface)
  })
})

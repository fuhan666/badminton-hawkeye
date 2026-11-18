import { useState } from 'react'
import type { FormEvent } from 'react'
import { buildEncoderConfig, EXPORT_FPS_OPTIONS, RESOLUTION_PRESETS } from '../export/exportSettings'
import type { ExportFps, ExportSettings as Settings } from '../export/exportSettings'

interface Props {
  settings: Settings
  onChange: (settings: Settings) => void
}

export default function ExportSettings({ settings, onChange }: Props) {
  const presetIndex = RESOLUTION_PRESETS.findIndex((preset) => preset.width === settings.width && preset.height === settings.height)
  const [custom, setCustom] = useState(presetIndex === -1)
  const [width, setWidth] = useState(String(settings.width))
  const [height, setHeight] = useState(String(settings.height))
  const [error, setError] = useState<string | null>(null)

  function applySize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = { ...settings, width: Number(width), height: Number(height) }
    try {
      buildEncoderConfig(next)
      onChange(next)
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  return (
    <>
      <button type="button" className="action" popoverTarget="export-settings" aria-label="导出设置">导出设置</button>
      <div id="export-settings" className="settings-popover" popover="auto">
        <div className="settings-popover__head">
          <h2>导出设置</h2>
          <button type="button" className="settings-close" popoverTarget="export-settings" popoverTargetAction="hide" aria-label="关闭导出设置">×</button>
        </div>
        <label className="settings-field">
          <span>分辨率</span>
          <select value={custom ? 'custom' : String(presetIndex)} onChange={(event) => {
            if (event.target.value === 'custom') {
              setWidth(String(settings.width))
              setHeight(String(settings.height))
              setCustom(true)
            } else {
              const preset = RESOLUTION_PRESETS[Number(event.target.value)]
              setCustom(false)
              setError(null)
              onChange({ ...settings, width: preset.width, height: preset.height })
            }
          }}>
            {['横屏', '竖屏', '手机长屏'].map((group) => (
              <optgroup key={group} label={group}>
                {RESOLUTION_PRESETS.map((preset, index) => preset.group === group ? (
                  <option key={index} value={index}>{preset.group === '手机长屏' ? preset.label : `${preset.label} · ${preset.width} × ${preset.height}`}</option>
                ) : null)}
              </optgroup>
            ))}
            <option value="custom">自定义</option>
          </select>
        </label>
        {custom ? (
          <>
            <form className="settings-size" onSubmit={applySize}>
              <label className="settings-field">
                <span>宽</span>
                <input
                  aria-label="导出宽度" type="number" min="2" step="2" required
                  value={width} onChange={(event) => { setWidth(event.target.value); setError(null) }}
                />
              </label>
              <span className="settings-size__times" aria-hidden="true">×</span>
              <label className="settings-field">
                <span>高</span>
                <input
                  aria-label="导出高度" type="number" min="2" step="2" required
                  value={height} onChange={(event) => { setHeight(event.target.value); setError(null) }}
                />
              </label>
              <button type="submit" className="action action--compact">应用</button>
            </form>
            {error ? <p className="settings-error" role="alert">{error}</p> : null}
          </>
        ) : null}
        <label className="settings-field">
          <span>帧率</span>
          <select value={settings.fps} onChange={(event) => onChange({ ...settings, fps: Number(event.target.value) as ExportFps })}>
            {EXPORT_FPS_OPTIONS.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
          </select>
        </label>
      </div>
    </>
  )
}

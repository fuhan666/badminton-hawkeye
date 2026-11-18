import { useEffect, useState } from 'react'
import { isHexColor, PALETTE_FIELDS } from '../courtColors'
import type { CourtPalette, PaletteField } from '../courtColors'

interface Props {
  palette: CourtPalette
  custom: boolean
  onActivate: () => void
  onChange: (field: PaletteField, color: string) => void
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  function commit() {
    if (isHexColor(hex)) onChange(hex.toLowerCase())
  }
  return (
    <div className="palette-field">
      <span>{label}</span>
      <input type="color" aria-label={`${label}颜色`} value={value} onChange={(event) => onChange(event.target.value)} />
      <input className="palette-field__hex" aria-label={`${label} HEX`} value={hex} pattern="#[0-9a-fA-F]{6}" required maxLength={7} spellCheck={false} onChange={(event) => setHex(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit() }} />
    </div>
  )
}

export default function PaletteSettings({ palette, custom, onActivate, onChange }: Props) {
  return (
    <>
      <button type="button" className={`palette-trigger${custom ? ' is-active' : ''}`} popoverTarget="palette-settings" aria-label="自定义配色" aria-pressed={custom} title="自定义配色" onClick={onActivate}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /><circle cx="17" cy="11.5" r="1" /></svg>
      </button>
      <div id="palette-settings" className="settings-popover" popover="auto">
        <div className="settings-popover__head">
          <h2>自定义配色</h2>
          <button type="button" className="settings-close" popoverTarget="palette-settings" popoverTargetAction="hide" aria-label="关闭自定义配色">×</button>
        </div>
        <div className="palette-fields">
          {PALETTE_FIELDS.map(({ key, label }) => <ColorField key={key} label={label} value={palette[key]} onChange={(color) => onChange(key, color)} />)}
        </div>
      </div>
    </>
  )
}

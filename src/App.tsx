import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import CourtView from './components/CourtView'
import ExportStatusBar from './components/ExportStatusBar'
import ExportSettings from './components/ExportSettings'
import PaletteSettings from './components/PaletteSettings'
import { useAppSettings } from './settings/useAppSettings'
import ReplayPreview from './components/ReplayPreview'
import type { EditTarget } from './components/CourtView'
import { COURT_COLORS, updatePalette } from './courtColors'
import type { CourtColor } from './courtColors'
import type { GroundPoint, MatchFormat } from './domain/court'
import { buildReplayInput, resolveDirection } from './domain/direction'
import type { FlightHeight } from './domain/direction'
import { isInsideCourt } from './domain/judgement'
import { CAMERA_PRESETS } from './domain/replay'
import type { CameraPreset } from './domain/replay'
import { useExportJob } from './export/useExportJob'

const FORMATS: { value: MatchFormat; label: string }[] = [
  { value: 'singles', label: '单打' },
  { value: 'doubles', label: '双打' },
]

const TARGETS: { value: EditTarget; label: string }[] = [
  { value: 'landing', label: '落点' },
  { value: 'incoming', label: '来向点' },
]

const HEIGHTS: { value: FlightHeight; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

export default function App() {
  const [format, setFormat] = useState<MatchFormat>('doubles')
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('classic')
  const [flightHeight, setFlightHeight] = useState<FlightHeight>('medium')
  const [settings, setSettings] = useAppSettings()
  const [landing, setLanding] = useState<GroundPoint>({ x: 2.2, z: 3.2 })
  const [incoming, setIncoming] = useState<GroundPoint | null>(null)
  const [target, setTarget] = useState<EditTarget>('landing')
  const exportJob = useExportJob()
  const palette = settings.paletteMode === 'custom' ? settings.customPalette! : COURT_COLORS[settings.paletteMode]
  const aspect = settings.export.width / settings.export.height

  const inBounds = isInsideCourt(landing, format)
  const direction = resolveDirection(landing, incoming)
  const replayInput = useMemo(
    () => buildReplayInput(format, landing, incoming, flightHeight),
    [format, landing, incoming, flightHeight],
  )

  function handleChange(next: EditTarget, point: GroundPoint) {
    if (next === 'landing') setLanding(point)
    else setIncoming(point)
  }

  function handleResetIncoming() {
    setIncoming(null)
    setTarget('incoming')
  }

  function handleExport() {
    if (!replayInput || exportJob.active) return
    void exportJob.startExport(replayInput, palette, settings.export, cameraPreset)
  }

  return (
    <div
      className="app"
      style={{
        '--court-surround': palette.editorSurround,
        '--replay-background': palette.background,
        '--replay-aspect': aspect,
        '--replay-max-width': `${480 * aspect}px`,
        '--marker-color': inBounds ? palette.editorMarkerIn : palette.editorMarkerOut,
        '--result-in': palette.editorResultIn,
        '--result-out': palette.editorResultOut,
      } as CSSProperties}
    >
      <header className="app__header">
        <h1>羽毛球鹰眼模拟器</h1>
        <div className="header__side">
          <div className="format" role="group" aria-label="赛制">
            {FORMATS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={item.value === format ? 'format__button is-active' : 'format__button'}
                aria-pressed={item.value === format}
                onClick={() => setFormat(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="court-colors" role="group" aria-label="地胶颜色">
            {(Object.keys(COURT_COLORS) as CourtColor[]).map((color) => (
              <button
                key={color}
                type="button"
                className={color === settings.paletteMode ? 'court-colors__button is-active' : 'court-colors__button'}
                aria-label={`${COURT_COLORS[color].label}地胶`}
                aria-pressed={color === settings.paletteMode}
                title={COURT_COLORS[color].label}
                onClick={() => setSettings((current) => ({ ...current, paletteMode: color }))}
              >
                <span style={{ backgroundColor: COURT_COLORS[color].surface }} />
              </button>
            ))}
            <PaletteSettings
              palette={palette}
              custom={settings.paletteMode === 'custom'}
              onActivate={() => setSettings((current) => ({
                ...current,
                paletteMode: 'custom',
                customPalette: current.customPalette ?? { ...palette },
              }))}
              onChange={(field, color) => setSettings((current) => ({
                ...current,
                paletteMode: 'custom',
                customPalette: updatePalette(current.customPalette!, field, color),
              }))}
            />
          </div>
          <div className="actions">
            <ExportSettings settings={settings.export} onChange={(value) => setSettings((current) => ({ ...current, export: value }))} />
            <button
              type="button"
              className="action action--primary"
              disabled={!replayInput || exportJob.active}
              onClick={handleExport}
            >
              {exportJob.active ? '导出中…' : '导出视频'}
            </button>
          </div>
        </div>
      </header>

      <ExportStatusBar
        status={exportJob.status}
        onCancel={exportJob.cancelExport}
        onDismiss={exportJob.dismissStatus}
      />

      <main className="layout">
        <section className="panel panel--court" aria-labelledby="court-title">
          <div className="panel__head">
            <h2 id="court-title">全场俯瞰</h2>
            <div className="court-toolbar">
              <div className="target-switch" role="group" aria-label="编辑目标">
                {TARGETS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={item.value === target ? 'target-switch__button is-active' : 'target-switch__button'}
                    aria-pressed={item.value === target}
                    onClick={() => setTarget(item.value)}
                  >
                    <span className={`target-dot target-dot--${item.value}`} aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="link-button"
                onClick={handleResetIncoming}
                disabled={!incoming}
              >
                清除来向点
              </button>
            </div>
          </div>
          <div className="court-area">
            <CourtView
              variant="full"
              format={format}
              palette={palette}
              landing={landing}
              incoming={incoming}
              target={target}
              onSelectTarget={setTarget}
              onChange={handleChange}
            />
          </div>
        </section>

        <aside className="side">
          <section
            className={inBounds ? 'panel verdict verdict--in' : 'panel verdict verdict--out'}
            aria-labelledby="zoom-title"
          >
            <div className="panel__head">
              <h2 id="zoom-title">局部精调</h2>
              <strong className="verdict__value" role="status" aria-label={`判定：${inBounds ? 'IN' : 'OUT'}`}>
                {inBounds ? 'IN' : 'OUT'}
              </strong>
            </div>
            <div className="zoom-area">
              <CourtView
                variant="zoom"
                format={format}
                palette={palette}
                landing={landing}
                incoming={incoming}
                target={target}
                onSelectTarget={setTarget}
                onChange={handleChange}
              />
            </div>
            <dl className="readout" aria-label="落点坐标">
              <div>
                <dt>落点 X</dt>
                <dd>{Math.round(landing.x * 1000)} mm</dd>
              </div>
              <div>
                <dt>落点 Z</dt>
                <dd>{Math.round(landing.z * 1000)} mm</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="replay-title">
            <div className="panel__head">
              <h2 id="replay-title">三维回放</h2>
              <div className="replay-height">
                <span id="height-label">过网高度</span>
                <div className="height-switch" role="group" aria-labelledby="height-label">
                  {HEIGHTS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={item.value === flightHeight ? 'height-switch__button is-active' : 'height-switch__button'}
                      aria-pressed={item.value === flightHeight}
                      onClick={() => setFlightHeight(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className="replay-camera">
              <span>镜头</span>
              <select aria-label="镜头预设" value={cameraPreset} onChange={(event) => setCameraPreset(event.target.value as CameraPreset)}>
                {CAMERA_PRESETS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {replayInput ? (
              <ReplayPreview input={replayInput} palette={palette} aspect={aspect} cameraPreset={cameraPreset} />
            ) : (
              <div
                className={direction.issue === 'coincident' ? 'replay__empty replay__empty--invalid' : 'replay__empty'}
                role={direction.issue === 'coincident' ? 'alert' : 'status'}
              >
                <p>
                  {direction.issue === 'coincident'
                    ? '来向点与落点重合，请移开来向点'
                    : '请在球场设置来向点'}
                </p>
              </div>
            )}
          </section>
        </aside>
      </main>
    </div>
  )
}

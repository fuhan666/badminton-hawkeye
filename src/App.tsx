import { useEffect, useMemo, useState } from 'react'
import CourtView from './components/CourtView'
import ExportStatusBar from './components/ExportStatusBar'
import ReplayPreview from './components/ReplayPreview'
import type { EditTarget } from './components/CourtView'
import { CONTACT_RADIUS } from './domain/court'
import type { GroundPoint, MatchFormat } from './domain/court'
import { MIN_DIRECTION_DISTANCE, buildReplayInput, resolveDirection } from './domain/direction'
import { isInsideCourt } from './domain/judgement'
import { useExportJob } from './export/useExportJob'

const FORMATS: { value: MatchFormat; label: string; note: string }[] = [
  { value: 'singles', label: '单打', note: '5.18 m 宽' },
  { value: 'doubles', label: '双打', note: '6.10 m 宽' },
]

const TARGETS: { value: EditTarget; label: string }[] = [
  { value: 'landing', label: '落点' },
  { value: 'incoming', label: '来向点' },
]

export default function App() {
  const [format, setFormat] = useState<MatchFormat>('doubles')
  const [landing, setLanding] = useState<GroundPoint>({ x: 2.2, z: 3.2 })
  const [incoming, setIncoming] = useState<GroundPoint | null>(null)
  const [target, setTarget] = useState<EditTarget>('landing')
  const [notice, setNotice] = useState<string | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [playSignal, setPlaySignal] = useState(0)
  const [pauseSignal, setPauseSignal] = useState(0)
  const exportJob = useExportJob()

  const inBounds = isInsideCourt(landing, format)
  const direction = resolveDirection(landing, incoming)
  const replayInput = useMemo(
    () => buildReplayInput(format, landing, incoming),
    [format, landing, incoming],
  )
  const ready = replayInput !== null

  // 输入变化即结束当前回放，预览组件会把时间轴回零
  useEffect(() => {
    setReplayPlaying(false)
  }, [replayInput])

  function handlePlayback() {
    if (replayPlaying) setPauseSignal((value) => value + 1)
    else setPlaySignal((value) => value + 1)
  }

  function handleChange(next: EditTarget, point: GroundPoint) {
    setNotice(null)
    if (next === 'landing') setLanding(point)
    else setIncoming(point)
  }

  function handleResetIncoming() {
    setIncoming(null)
    setTarget('incoming')
    setNotice(null)
  }

  function handleExport() {
    if (!replayInput || exportJob.active) return
    setNotice(null)
    void exportJob.startExport(replayInput)
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>羽毛球鹰眼模拟器</h1>
          <p className="app__subtitle">选点 · 判定 · 三维回放 · 场地尺寸取自 BWF 规则，量至白线外沿</p>
        </div>
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
                <span>{item.label}</span>
                <small>{item.note}</small>
              </button>
            ))}
          </div>
          <div className="actions">
            <button
              type="button"
              className="action"
              disabled={!ready}
              title={ready ? '在右侧预览中播放三维回放' : '需要有效的落点与来向方向'}
              onClick={handlePlayback}
            >
              {replayPlaying ? '暂停' : '播放'}
            </button>
            <button
              type="button"
              className="action action--primary"
              disabled={!ready || exportJob.active}
              title={
                !ready
                  ? '需要有效的落点与来向方向'
                  : exportJob.active
                    ? '导出进行中，可先取消'
                    : '导出 1920×1080 / 30 fps / 5 s 的 MP4'
              }
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
        <section className="panel panel--court">
          <div className="panel__head">
            <h2>全场俯瞰</h2>
            <span className="panel__hint">场内、压线与四周 1 m 场外均可点选</span>
          </div>
          <div className="steps">
            <span>① 点击球场放置落点</span>
            <span>② 选「来向点」后再点一次</span>
            <span>③ 拖动或方向键微调（1 mm，Shift 10 mm）</span>
          </div>
          <div className="court-area">
            <CourtView
              variant="full"
              format={format}
              landing={landing}
              incoming={incoming}
              target={target}
              onSelectTarget={setTarget}
              onChange={handleChange}
            />
          </div>
          <div className="legend">
            <span className="legend__item">
              <i className="legend__dot legend__dot--landing" />
              落点与 13 mm 接触圆
            </span>
            <span className="legend__item">
              <i className="legend__dot legend__dot--incoming" />
              来向点（只决定方向，箭头由落点指向它）
            </span>
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <div className="panel__head">
              <h2>编辑目标</h2>
              <span className="panel__hint">两个点都可再次拖动</span>
            </div>
            <div className="target-switch" role="group" aria-label="编辑目标">
              {TARGETS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={item.value === target ? 'target-switch__button is-active' : 'target-switch__button'}
                  aria-pressed={item.value === target}
                  onClick={() => {
                    setTarget(item.value)
                    setNotice(null)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="target-note">
              {target === 'landing'
                ? '当前调整落点：点击球场重新放置，或拖动黄色手柄。'
                : incoming
                  ? '当前调整来向点：点击球场移动，或拖动蓝色手柄。'
                  : '尚未放置来向点：点击球场放置，随后可用方向键微调。'}
            </p>
            <button
              type="button"
              className="link-button"
              onClick={handleResetIncoming}
              disabled={!incoming}
            >
              清除来向点
            </button>
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2>局部精调</h2>
              <span className="panel__hint">等比放大，接触圆为真实 13 mm</span>
            </div>
            <div className="zoom-area">
              <CourtView
                variant="zoom"
                format={format}
                landing={landing}
                incoming={incoming}
                target={target}
                onSelectTarget={setTarget}
                onChange={handleChange}
              />
            </div>
          </section>

          <section className={direction.issue ? 'panel direction direction--invalid' : 'panel direction'}>
            <div className="verdict__row">
              <span className="verdict__label">来向</span>
              <strong className="verdict__value verdict__value--small">
                {direction.unit ? '已设定' : '未完成'}
              </strong>
            </div>
            {direction.issue === 'missing' ? (
              <p className="direction__note">选择「来向点」后点击球场，箭头方向即来球方向。</p>
            ) : null}
            {direction.issue === 'coincident' ? (
              <p className="direction__alert" role="alert">
                来向点与落点重合，请调整（两点距离需 ≥ {Math.round(MIN_DIRECTION_DISTANCE * 1000)} mm）。
              </p>
            ) : null}
            {direction.unit ? (
              <p className="direction__note">
                单位方向 ({direction.unit.x.toFixed(3)}, {direction.unit.z.toFixed(3)})，两点距离{' '}
                {(direction.distance * 1000).toFixed(0)} mm 不参与回放输入。
              </p>
            ) : null}
          </section>

          <section className={inBounds ? 'panel verdict verdict--in' : 'panel verdict verdict--out'}>
            <div className="verdict__row">
              <span className="verdict__label">判定</span>
              <strong className="verdict__value">{inBounds ? 'IN' : 'OUT'}</strong>
            </div>
            <p className="verdict__note">
              {inBounds
                ? '接触圆与有效区域相交或相切，白线属于界内。'
                : '接触圆与有效区域完全分离。'}
            </p>
            <dl className="readout">
              <div>
                <dt>圆心 x</dt>
                <dd>
                  {landing.x.toFixed(3)} m
                  <small>{Math.round(landing.x * 1000)} mm</small>
                </dd>
              </div>
              <div>
                <dt>圆心 z</dt>
                <dd>
                  {landing.z.toFixed(3)} m
                  <small>{Math.round(landing.z * 1000)} mm</small>
                </dd>
              </div>
              <div>
                <dt>接触半径</dt>
                <dd>
                  {CONTACT_RADIUS.toFixed(3)} m
                  <small>模拟初值</small>
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2>三维回放</h2>
              <span className="panel__hint">约 5 s · 四段分镜</span>
            </div>
            {replayInput ? (
              <ReplayPreview
                input={replayInput}
                playSignal={playSignal}
                pauseSignal={pauseSignal}
                onPlayingChange={setReplayPlaying}
              />
            ) : (
              <p className="replay__empty">
                放置落点并设定来向点后，这里会生成三维回放；两点重合或缺少来向时不播放。
              </p>
            )}
          </section>

          <section className="panel tips">
            <h2>操作</h2>
            <ul>
              <li>先放落点，再切到「来向点」放置第二点；箭头由落点指向来向点。</li>
              <li>拖动任一手柄，或聚焦球场后用方向键 1 mm、Shift 10 mm 微调。</li>
              <li>来向点只决定方向，同方向不同距离得到相同输入。</li>
              <li>两点重合时播放与导出保持禁用，拖开即恢复。</li>
              <li>回放约 5 秒：全景、跟随、慢放触地、印记与结果；可暂停、重播或拖动时间轴。</li>
              <li>导出按点击时的设置生成 1920×1080 / 30 fps / 5 s 的 MP4，期间可取消；导出中继续编辑不影响本次文件。</li>
              <li>切换单打／双打保留两个点，只更新有效边界与判定。</li>
            </ul>
            {notice ? <p className="tips__notice">{notice}</p> : null}
          </section>
        </aside>
      </main>
    </div>
  )
}

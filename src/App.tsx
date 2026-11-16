import { useState } from 'react'
import CourtView from './components/CourtView'
import { CONTACT_RADIUS } from './domain/court'
import type { GroundPoint, MatchFormat } from './domain/court'
import { isInsideCourt } from './domain/judgement'

const FORMATS: { value: MatchFormat; label: string; note: string }[] = [
  { value: 'singles', label: '单打', note: '5.18 m 宽' },
  { value: 'doubles', label: '双打', note: '6.10 m 宽' },
]

export default function App() {
  const [format, setFormat] = useState<MatchFormat>('doubles')
  const [center, setCenter] = useState<GroundPoint>({ x: 2.2, z: 3.2 })

  const inBounds = isInsideCourt(center, format)

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>羽毛球鹰眼模拟器</h1>
          <p className="app__subtitle">选点与判定 · 场地尺寸取自 BWF 规则，量至白线外沿</p>
        </div>
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
      </header>

      <main className="layout">
        <section className="panel panel--court">
          <div className="panel__head">
            <h2>全场俯瞰</h2>
            <span className="panel__hint">场内、压线与四周 1 m 场外均可点选</span>
          </div>
          <div className="court-area">
            <CourtView variant="full" format={format} center={center} onChange={setCenter} />
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <div className="panel__head">
              <h2>局部精调</h2>
              <span className="panel__hint">等比放大，接触圆为真实 13 mm</span>
            </div>
            <div className="zoom-area">
              <CourtView variant="zoom" format={format} center={center} onChange={setCenter} />
            </div>
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
                  {center.x.toFixed(3)} m
                  <small>{Math.round(center.x * 1000)} mm</small>
                </dd>
              </div>
              <div>
                <dt>圆心 z</dt>
                <dd>
                  {center.z.toFixed(3)} m
                  <small>{Math.round(center.z * 1000)} mm</small>
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

          <section className="panel tips">
            <h2>操作</h2>
            <ul>
              <li>点击全场或局部视图重新放置落点。</li>
              <li>拖动手柄微调；局部视图拖动时视窗固定，不会跳动。</li>
              <li>切换单打／双打保留落点，只更新有效边界与判定。</li>
            </ul>
          </section>
        </aside>
      </main>
    </div>
  )
}

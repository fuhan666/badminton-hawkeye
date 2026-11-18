import type { ExportStatus } from '../export/useExportJob'

interface ExportStatusBarProps {
  status: ExportStatus
  onCancel: () => void
  onDismiss: () => void
}

const RUNNING_PHASES = ['preparing', 'encoding', 'muxing', 'finalizing', 'cancelling']

const TITLES: Record<ExportStatus['phase'], string> = {
  idle: '',
  preparing: '导出中',
  encoding: '导出中',
  muxing: '导出中',
  finalizing: '导出中',
  cancelling: '取消中',
  done: '导出完成',
  cancelled: '导出已取消',
  error: '导出失败',
  unsupported: '当前环境不支持导出',
}

/** 导出进度与结果提示；导出期间同时提供取消入口。 */
export default function ExportStatusBar({ status, onCancel, onDismiss }: ExportStatusBarProps) {
  if (status.phase === 'idle') return null

  const running = RUNNING_PHASES.includes(status.phase)
  const tone =
    status.phase === 'done'
      ? 'success'
      : status.phase === 'cancelled' || status.phase === 'cancelling'
        ? 'muted'
        : running
          ? 'running'
          : 'alert'

  return (
    <section
      className={`export-bar export-bar--${tone}`}
      data-export-phase={status.phase}
      aria-live="polite"
    >
      <div className="export-bar__row">
        <strong className="export-bar__title">{TITLES[status.phase]}</strong>
        {running || status.phase === 'done' ? (
          <span className="export-bar__percent">{status.percent}%</span>
        ) : null}
      </div>
      {running ? (
        <div
          className="export-bar__track"
          role="progressbar"
          aria-label="导出进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.percent}
        >
          <div className="export-bar__fill" style={{ width: `${status.percent}%` }} />
        </div>
      ) : null}
      {status.message ? <p className="export-bar__message">{status.message}</p> : null}
      <div className="export-bar__actions">
        {status.phase === 'cancelling' ? (
          <button type="button" className="action action--compact" disabled>
            取消中…
          </button>
        ) : running ? (
          <button type="button" className="action action--compact" onClick={onCancel}>
            取消导出
          </button>
        ) : (
          <button type="button" className="action action--compact" onClick={onDismiss}>
            关闭
          </button>
        )}
      </div>
    </section>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CourtPalette } from '../courtColors'
import type { ExportSettings } from './exportSettings'
import { REPLAY_DURATION } from '../domain/replay'
import type { ReplayInput } from '../domain/direction'
import {
  ExportCancelledError,
  ExportUnsupportedError,
  exportReplay,
} from './exportReplay'
import type { ExportPhase } from './exportReplay'

export type ExportStatusPhase = 'idle' | ExportPhase | 'cancelling' | 'done' | 'cancelled' | 'error' | 'unsupported'

export interface ExportStatus {
  phase: ExportStatusPhase
  /** 按已编码帧数计算的 0–100 进度 */
  percent: number
  encodedFrames: number
  totalFrames: number
  /** 面向用户的说明，失败或完成时给出原因 */
  message: string | null
}

const IDLE: ExportStatus = {
  phase: 'idle',
  percent: 0,
  encodedFrames: 0,
  totalFrames: 0,
  message: null,
}

function triggerDownload(blob: Blob, filename: string, urls: Set<string>) {
  const url = URL.createObjectURL(blob)
  urls.add(url)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  // 留出浏览器读取 Blob 的时间，随后撤销 URL
  window.setTimeout(() => {
    if (urls.delete(url)) URL.revokeObjectURL(url)
  }, 10_000)
}

/**
 * 单个活动导出任务：负责进度状态、取消与下载。
 * 导出使用点击时的输入快照，导出期间继续编辑不会改变本次视频。
 */
export function useExportJob() {
  const [status, setStatus] = useState<ExportStatus>(IDLE)
  const controllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const urlsRef = useRef<Set<string>>(new Set())

  const active =
    status.phase === 'preparing' ||
    status.phase === 'encoding' ||
    status.phase === 'muxing' ||
    status.phase === 'finalizing' ||
    status.phase === 'cancelling'

  const startExport = useCallback(async (input: ReplayInput, palette: CourtPalette, settings: ExportSettings) => {
    // 同一时间只允许一个导出任务
    if (controllerRef.current) return
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus({ ...IDLE, phase: 'preparing', totalFrames: settings.fps * REPLAY_DURATION })

    try {
      const result = await exportReplay({
        input,
        palette,
        settings,
        signal: controller.signal,
        onProgress: (progress) => {
          if (runIdRef.current !== runId) return
          setStatus({
            phase: progress.phase,
            percent: progress.percent,
            encodedFrames: progress.encodedFrames,
            totalFrames: progress.totalFrames,
            message: null,
          })
        },
      })
      if (runIdRef.current !== runId) return
      triggerDownload(result.blob, result.filename, urlsRef.current)
      setStatus({
        phase: 'done',
        percent: 100,
        encodedFrames: result.frames,
        totalFrames: result.frames,
        message: null,
      })
    } catch (error) {
      if (runIdRef.current !== runId) return
      if (error instanceof ExportCancelledError) {
        setStatus({ ...IDLE, phase: 'cancelled' })
        return
      }
      if (error instanceof ExportUnsupportedError) {
        setStatus({ ...IDLE, phase: 'unsupported', message: error.message })
        return
      }
      const detail = error instanceof Error ? error.message : String(error)
      setStatus({
        ...IDLE,
        phase: 'error',
        message: detail,
      })
    } finally {
      if (runIdRef.current === runId) controllerRef.current = null
    }
  }, [])

  const cancelExport = useCallback(() => {
    const controller = controllerRef.current
    if (!controller || controller.signal.aborted) return
    setStatus((current) => ({
      ...current,
      phase: 'cancelling',
      message: null,
    }))
    controller.abort()
  }, [])

  const dismissStatus = useCallback(() => {
    if (controllerRef.current) return
    setStatus(IDLE)
  }, [])

  // 组件卸载时中止任务并撤销尚未释放的下载 URL
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      for (const url of urlsRef.current) URL.revokeObjectURL(url)
      urlsRef.current.clear()
    }
  }, [])

  return { status, active, startExport, cancelExport, dismissStatus }
}

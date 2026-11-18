import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import type { CourtPalette } from '../courtColors'
import { buildEncoderConfig } from './exportSettings'
import type { ExportSettings } from './exportSettings'
import type { ReplayInput } from '../domain/direction'
import { REPLAY_DURATION, evaluateReplay } from '../domain/replay'
import { createReplayScene } from '../replay/scene'
import type { ReplayScene } from '../replay/scene'

/** 背压阈值：编码队列超过该帧数时等待 dequeue 事件。 */
const MAX_ENCODE_QUEUE = 8
/** 每编码多少帧让出一次事件循环，让进度能绘制、取消能响应。 */
const YIELD_EVERY_FRAMES = 5

export type ExportPhase =
  | 'preparing'
  | 'encoding'
  | 'muxing'
  | 'finalizing'

export interface ExportProgress {
  phase: ExportPhase
  encodedFrames: number
  totalFrames: number
  /** 按已编码帧数计算的 0–100 整数进度 */
  percent: number
}

export type ExportSupport =
  | { supported: true }
  | { supported: false; reason: string }

export class ExportCancelledError extends Error {
  constructor() {
    super('导出已取消')
    this.name = 'ExportCancelledError'
  }
}

export class ExportUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportUnsupportedError'
  }
}

/** 第 index 帧的时间戳边界，单位微秒。 */
export function frameBoundaryUs(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps)
}

/** 第 index 帧的编码时间戳与时长（相邻边界之差）。 */
export function frameTiming(index: number, fps: number): { timestamp: number; duration: number } {
  const timestamp = frameBoundaryUs(index, fps)
  return { timestamp, duration: frameBoundaryUs(index + 1, fps) - timestamp }
}

/** 已编码帧数换算成 0–100 的整数进度。 */
export function progressPercent(
  encodedFrames: number,
  totalFrames: number,
): number {
  if (totalFrames <= 0) return 0
  const ratio = Math.min(Math.max(encodedFrames, 0), totalFrames) / totalFrames
  return Math.round(ratio * 100)
}

export function isKeyFrame(index: number, fps: number): boolean {
  return index % fps === 0
}

/** 导出开始时的输入快照：后续编辑不再影响本次视频。 */
export function freezeExportInput(input: ReplayInput): ReplayInput {
  return {
    format: input.format,
    landing: { ...input.landing },
    direction: { ...input.direction },
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 文件名带赛制、落点与本地时间，便于同一输入多次导出后区分。 */
export function buildExportFilename(input: ReplayInput, settings: ExportSettings, now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const x = input.landing.x.toFixed(3)
  const z = input.landing.z.toFixed(3)
  return `badminton-hawkeye-${input.format}-x${x}-z${z}-${settings.width}x${settings.height}-${settings.fps}fps-${stamp}.mp4`
}

/** 以 isConfigSupported 为准判断能否编码，不按浏览器品牌推断。 */
export async function checkExportSupport(config: VideoEncoderConfig): Promise<ExportSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return {
      supported: false,
      reason: '当前浏览器不支持 WebCodecs 视频编码，无法导出 MP4；三维预览不受影响。',
    }
  }

  try {
    const result = await VideoEncoder.isConfigSupported(config)
    if (!result.supported) {
      return {
        supported: false,
        reason: `当前环境不支持 H.264 ${config.width}×${config.height} / ${config.framerate} fps 编码。`,
      }
    }
    return { supported: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      supported: false,
      reason: `无法确认当前环境的 H.264 编码能力（${detail}），暂时不能导出；三维预览不受影响。`,
    }
  }
}

/**
 * 导出后端：隔离浏览器 API，便于在 node 环境下用假实现验证
 * 帧循环、进度、取消与资源释放。
 */
export interface ExportBackend {
  /** 准备画布、场景、编码器与封装；不支持时抛 ExportUnsupportedError */
  start(onEncoded: (encodedFrames: number) => void): Promise<void>
  renderFrame(index: number): void
  encodeFrame(index: number, keyFrame: boolean): void
  readonly encodeQueueSize: number
  waitForDequeue(): Promise<void>
  /** 编码或封装回调中记录的错误 */
  getError(): Error | null
  /** flush 编码、等待写入链、关闭 source 并 finalize；封装完成前不产出结果 */
  finish(signal: AbortSignal | undefined): Promise<void>
  getResult(): Blob
  /** 关闭编码器、丢弃未完成的封装、释放场景与画布引用 */
  dispose(): Promise<void>
}

interface BrowserBackendState {
  canvas: HTMLCanvasElement | null
  scene: ReplayScene | null
  encoder: VideoEncoder | null
  output: Output | null
  source: EncodedVideoPacketSource | null
  target: BufferTarget | null
  writeChain: Promise<void> | null
  muxError: Error | null
  encoderError: Error | null
  encodedFrames: number
  blob: Blob | null
}

function createBrowserBackend(input: ReplayInput, palette: CourtPalette, settings: ExportSettings): ExportBackend {
  const config = buildEncoderConfig(settings)
  const { width, height, fps } = settings
  const state: BrowserBackendState = {
    canvas: null,
    scene: null,
    encoder: null,
    output: null,
    source: null,
    target: null,
    writeChain: null,
    muxError: null,
    encoderError: null,
    encodedFrames: 0,
    blob: null,
  }

  return {
    async start(onEncoded) {
      const support = await checkExportSupport(config)
      if (!support.supported) throw new ExportUnsupportedError(support.reason)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      state.canvas = canvas
      const scene = createReplayScene(canvas, palette, { pixelRatio: 1 })
      state.scene = scene
      scene.resize(width, height)
      if (canvas.width !== width || canvas.height !== height) {
        throw new Error(`导出画布尺寸 ${canvas.width}×${canvas.height} 与目标不一致`)
      }

      const target = new BufferTarget()
      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
      })
      const source = new EncodedVideoPacketSource('avc')
      output.addVideoTrack(source, { frameRate: fps })
      await output.start()
      state.target = target
      state.output = output
      state.source = source

      let writeChain: Promise<void> = Promise.resolve()
      state.writeChain = writeChain

      const encoder = new VideoEncoder({
        output: (chunk, meta: EncodedVideoChunkMetadata | undefined) => {
          state.encodedFrames += 1
          const packet = EncodedPacket.fromEncodedChunk(chunk)
          // 串行写入，保持编码顺序；封装异常必须冒泡到最终结果。
          writeChain = writeChain
            .then(() => source.add(packet, meta))
            .catch((error: unknown) => {
              state.muxError = error instanceof Error ? error : new Error(String(error))
            })
          state.writeChain = writeChain
          onEncoded(state.encodedFrames)
        },
        error: (error) => {
          state.encoderError = error instanceof Error ? error : new Error(String(error))
        },
      })
      encoder.configure(config)
      state.encoder = encoder
    },

    renderFrame(index) {
      const scene = state.scene
      if (!scene) throw new Error('导出场景尚未创建')
      scene.render(evaluateReplay(input, index / fps, width / height))
    },

    encodeFrame(index, keyFrame) {
      const { encoder, canvas, encoderError } = state
      if (encoderError) throw encoderError
      if (!encoder || !canvas) throw new Error('导出编码器尚未创建')
      const { timestamp, duration } = frameTiming(index, fps)
      const frame = new VideoFrame(canvas, { timestamp, duration })
      try {
        encoder.encode(frame, { keyFrame })
      } finally {
        frame.close()
      }
    },

    get encodeQueueSize() {
      return state.encoder?.encodeQueueSize ?? 0
    },

    waitForDequeue() {
      const encoder = state.encoder
      if (!encoder) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const onDequeue = () => {
          encoder.removeEventListener('dequeue', onDequeue)
          resolve()
        }
        encoder.addEventListener('dequeue', onDequeue)
      })
    },

    getError() {
      return state.encoderError ?? state.muxError
    },

    async finish(signal) {
      const { encoder, source, output, target } = state
      if (!encoder || !source || !output || !target) throw new Error('导出尚未开始')

      await encoder.flush()
      if (state.encoderError) throw state.encoderError
      throwIfAborted(signal)
      await state.writeChain
      if (state.muxError) throw state.muxError
      throwIfAborted(signal)

      source.close()
      throwIfAborted(signal)
      await output.finalize()
      if (!target.buffer) throw new Error('封装完成但没有输出缓冲')
      state.blob = new Blob([target.buffer], { type: 'video/mp4' })
    },

    getResult() {
      if (!state.blob) throw new Error('导出尚未完成')
      return state.blob
    },

    async dispose() {
      const { encoder, output, scene, writeChain } = state
      state.canvas = null
      state.scene = null
      state.source = null
      state.target = null
      state.encoder = null
      state.output = null

      if (encoder && encoder.state !== 'closed') {
        try {
          encoder.close()
        } catch {
          // 已经关闭或出错时忽略
        }
      }
      if (output && (output.state === 'pending' || output.state === 'started')) {
        try {
          await output.cancel()
        } catch {
          // 取消只用于丢弃半成品，失败不影响主流程
        }
      }
      // 已排队的写入可能仍在进行，等它收尾，避免未处理的拒绝。
      if (writeChain) {
        try {
          await writeChain
        } catch {
          // 写入错误已经记录在状态里
        }
      }
      scene?.dispose()
    },
  }
}

export interface ExportOptions {
  input: ReplayInput
  palette: CourtPalette
  settings: ExportSettings
  signal?: AbortSignal
  onProgress?: (progress: ExportProgress) => void
  /** 测试注入点：默认使用浏览器 WebCodecs 后端 */
  backend?: ExportBackend
}

export interface ExportResult {
  blob: Blob
  filename: string
  frames: number
  keyFrames: number
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ExportCancelledError()
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 等待编码队列下降，同时响应取消，避免卡在永远不会触发的 dequeue 上。 */
function waitForDequeueOrAbort(
  backend: ExportBackend,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(new ExportCancelledError())
    }
    const onDone = (error?: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    backend.waitForDequeue().then(
      () => onDone(),
      (error: unknown) => onDone(error),
    )
    if (signal?.aborted) onAbort()
  })
}

/**
 * 导出入口：固定输入逐帧渲染编码，按已编码帧数上报进度，
 * 取消时停止送帧并丢弃封装结果，成功时返回可下载的 MP4 Blob。
 */
export async function exportReplay(options: ExportOptions): Promise<ExportResult> {
  const { signal, onProgress } = options
  const input = freezeExportInput(options.input)
  const settings = { ...options.settings }
  const palette = { ...options.palette }
  buildEncoderConfig(settings)
  const totalFrames = Math.round(settings.fps * REPLAY_DURATION)
  const backend = options.backend ?? createBrowserBackend(input, palette, settings)

  let encodedFrames = 0
  const emit = (phase: ExportPhase, frames = encodedFrames) => {
    onProgress?.({
      phase,
      encodedFrames: frames,
      totalFrames,
      percent: progressPercent(frames, totalFrames),
    })
  }

  try {
    throwIfAborted(signal)
    emit('preparing', 0)
    await backend.start((frames) => {
      encodedFrames = frames
      emit('encoding', frames)
    })
    throwIfAborted(signal)

    for (let index = 0; index < totalFrames; index += 1) {
      throwIfAborted(signal)
      backend.renderFrame(index)
      backend.encodeFrame(index, isKeyFrame(index, settings.fps))
      const error = backend.getError()
      if (error) throw error

      if (backend.encodeQueueSize > MAX_ENCODE_QUEUE) {
        await waitForDequeueOrAbort(backend, signal)
        const queued = backend.getError()
        if (queued) throw queued
      }
      if (index % YIELD_EVERY_FRAMES === YIELD_EVERY_FRAMES - 1) {
        await yieldToEventLoop()
        throwIfAborted(signal)
      }
    }

    throwIfAborted(signal)
    emit('muxing')
    await backend.finish(signal)
    // 下载前最后确认一次取消，避免取消后仍产出文件。
    throwIfAborted(signal)

    const blob = backend.getResult()
    emit('finalizing', totalFrames)
    return {
      blob,
      filename: buildExportFilename(input, settings),
      frames: totalFrames,
      keyFrames: Math.ceil(totalFrames / settings.fps),
    }
  } catch (error) {
    if (error instanceof ExportCancelledError || signal?.aborted) {
      throw new ExportCancelledError()
    }
    throw error
  } finally {
    try {
      await backend.dispose()
    } catch {
      // 释放失败不应覆盖上面的成功结果或原始错误
    }
  }
}

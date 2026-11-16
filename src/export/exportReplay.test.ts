import { describe, expect, it } from 'vitest'
import { buildReplayInput } from '../domain/direction'
import type { ReplayInput } from '../domain/direction'
import {
  EXPORT_FRAME_COUNT,
  EXPORT_KEYFRAME_INTERVAL,
  ExportCancelledError,
  ExportUnsupportedError,
  buildExportFilename,
  exportReplay,
  frameTiming,
  freezeExportInput,
  progressPercent,
} from './exportReplay'
import type { ExportBackend, ExportProgress } from './exportReplay'

function input(): ReplayInput {
  const value = buildReplayInput('doubles', { x: 3.055, z: 3.2 }, { x: 3.055, z: 0 })
  if (!value) throw new Error('测试输入应产生有效方向')
  return value
}

interface FakeOptions {
  queueSize?: number
  unsupported?: boolean
  error?: Error | null
  finishError?: Error | null
  onWait?: () => void
  onStart?: () => void
}

function createFakeBackend(options: FakeOptions = {}) {
  const rendered: number[] = []
  const encodedIndices: number[] = []
  const keyFrames: number[] = []
  const stats = { started: 0, finished: 0, disposed: 0, waits: 0 }
  let report: ((frames: number) => void) | null = null
  let encodedFrames = 0

  const backend: ExportBackend = {
    async start(onEncoded) {
      stats.started += 1
      options.onStart?.()
      if (options.unsupported) {
        throw new ExportUnsupportedError('当前环境不支持 H.264 1080p 编码，无法导出 MP4；三维预览不受影响。')
      }
      report = onEncoded
    },
    renderFrame(index) {
      rendered.push(index)
    },
    encodeFrame(index, keyFrame) {
      encodedIndices.push(index)
      if (keyFrame) keyFrames.push(index)
      encodedFrames += 1
      report?.(encodedFrames)
    },
    get encodeQueueSize() {
      return options.queueSize ?? 0
    },
    waitForDequeue() {
      stats.waits += 1
      options.onWait?.()
      return new Promise<void>(() => {
        // 永不自行触发，只有取消才能唤醒
      })
    },
    getError() {
      return options.error ?? null
    },
    async finish(signal) {
      stats.finished += 1
      if (signal?.aborted) throw new ExportCancelledError()
      if (options.finishError) throw options.finishError
    },
    getResult() {
      return new Blob(['mp4'], { type: 'video/mp4' })
    },
    async dispose() {
      stats.disposed += 1
    },
  }

  return { backend, rendered, encodedIndices, keyFrames, stats }
}

describe('导出时间轴', () => {
  it('150 帧覆盖 0 到 5,000,000 µs，相邻边界差为帧时长', () => {
    expect(frameTiming(0)).toEqual({ timestamp: 0, duration: 33333 })
    expect(frameTiming(1)).toEqual({ timestamp: 33333, duration: 33334 })
    expect(frameTiming(2)).toEqual({ timestamp: 66667, duration: 33333 })
    expect(frameTiming(149).timestamp).toBe(4_966_667)
    expect(frameTiming(149).timestamp + frameTiming(149).duration).toBe(5_000_000)
  })

  it('时间戳严格递增且末帧只编到 5 s', () => {
    for (let index = 1; index < EXPORT_FRAME_COUNT; index += 1) {
      expect(frameTiming(index).timestamp).toBeGreaterThan(frameTiming(index - 1).timestamp)
    }
  })
})

describe('导出进度', () => {
  it('按已编码帧数换算 0–100 并夹取越界值', () => {
    expect(progressPercent(0)).toBe(0)
    expect(progressPercent(75)).toBe(50)
    expect(progressPercent(EXPORT_FRAME_COUNT)).toBe(100)
    expect(progressPercent(EXPORT_FRAME_COUNT + 10)).toBe(100)
    expect(progressPercent(-5)).toBe(0)
  })
})

describe('导出文件名', () => {
  it('包含赛制、落点与时间戳', () => {
    const name = buildExportFilename(input(), new Date(2026, 10, 16, 15, 5, 7))
    expect(name).toBe('badminton-hawkeye-doubles-x3.055-z3.200-20261116-150507.mp4')
  })
})

describe('输入快照', () => {
  it('复制落点与方向，后续修改不影响导出输入', () => {
    const source = input()
    const snapshot = freezeExportInput(source)
    source.landing.x = 99
    source.direction.z = -1
    expect(snapshot.landing).toEqual({ x: 3.055, z: 3.2 })
    expect(snapshot.direction).toEqual({ x: 0, z: 1 })
  })
})

describe('exportReplay 帧循环', () => {
  it('逐帧渲染编码 150 帧，每 30 帧一个关键帧，完成后才产出结果', async () => {
    const fake = createFakeBackend()
    const phases: string[] = []
    const percents: number[] = []
    const result = await exportReplay({
      input: input(),
      backend: fake.backend,
      onProgress: (progress: ExportProgress) => {
        phases.push(progress.phase)
        percents.push(progress.percent)
      },
    })

    expect(fake.rendered).toEqual(Array.from({ length: EXPORT_FRAME_COUNT }, (_, i) => i))
    expect(fake.encodedIndices).toEqual(fake.rendered)
    expect(fake.keyFrames).toEqual([0, 30, 60, 90, 120])
    expect(fake.keyFrames).toHaveLength(Math.ceil(EXPORT_FRAME_COUNT / EXPORT_KEYFRAME_INTERVAL))
    expect(fake.stats.finished).toBe(1)
    expect(fake.stats.disposed).toBe(1)
    expect(phases[0]).toBe('preparing')
    expect(phases).toContain('muxing')
    expect(phases.at(-1)).toBe('finalizing')
    expect(percents[0]).toBe(0)
    expect(percents.at(-1)).toBe(100)
    expect(result.frames).toBe(EXPORT_FRAME_COUNT)
    expect(result.keyFrames).toBe(5)
    expect(result.blob.type).toBe('video/mp4')
    expect(result.filename.endsWith('.mp4')).toBe(true)
  })
})

describe('exportReplay 取消与清理', () => {
  it('开始前已取消时不启动后端，仍进入统一清理', async () => {
    const fake = createFakeBackend()
    const controller = new AbortController()
    controller.abort()
    await expect(
      exportReplay({ input: input(), backend: fake.backend, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ExportCancelledError)
    expect(fake.stats.started).toBe(0)
    expect(fake.stats.disposed).toBe(1)
  })

  it('背压等待期间取消立即结束，不继续送帧、不封装', async () => {
    const controller = new AbortController()
    const fake = createFakeBackend({ queueSize: 9, onWait: () => controller.abort() })
    await expect(
      exportReplay({ input: input(), backend: fake.backend, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ExportCancelledError)
    expect(fake.stats.waits).toBe(1)
    expect(fake.encodedIndices).toHaveLength(1)
    expect(fake.stats.finished).toBe(0)
    expect(fake.stats.disposed).toBe(1)

    // 取消后可以在同一输入上重新导出成功
    const retry = createFakeBackend()
    const result = await exportReplay({ input: input(), backend: retry.backend })
    expect(result.frames).toBe(EXPORT_FRAME_COUNT)
    expect(retry.stats.finished).toBe(1)
  })

  it('编码错误直接冒泡并释放资源', async () => {
    const fake = createFakeBackend({ error: new Error('编码失败') })
    await expect(
      exportReplay({ input: input(), backend: fake.backend }),
    ).rejects.toThrow('编码失败')
    expect(fake.stats.finished).toBe(0)
    expect(fake.stats.disposed).toBe(1)
  })

  it('封装失败不产出结果并释放资源', async () => {
    const fake = createFakeBackend({ finishError: new Error('封装失败') })
    await expect(
      exportReplay({ input: input(), backend: fake.backend }),
    ).rejects.toThrow('封装失败')
    expect(fake.stats.disposed).toBe(1)
  })

  it('环境不支持时抛出可读原因，预览不受影响的提示保留', async () => {
    const fake = createFakeBackend({ unsupported: true })
    await expect(
      exportReplay({ input: input(), backend: fake.backend }),
    ).rejects.toThrow(/不支持 H\.264 1080p 编码/)
    expect(fake.stats.disposed).toBe(1)
  })
})

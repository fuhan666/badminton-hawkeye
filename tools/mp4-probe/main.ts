import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { buildReplayInput } from '../../src/domain/direction'
import { REPLAY_DURATION, evaluateReplay } from '../../src/domain/replay'
import { createReplayScene } from '../../src/replay/scene'

/**
 * 最小验证：固定双打输入按 30 fps 逐帧渲染，用 WebCodecs 编 H.264，
 * 经 mediabunny 封装成 MP4。只服务技术验证，不进入产品入口。
 */

const FPS = 30
const FRAME_COUNT = Math.round(FPS * REPLAY_DURATION)
const BITRATE = 8_000_000

const LANDING = { x: 3.055, z: 3.2 }
const INCOMING = { x: 3.055, z: 0 }

interface Candidate {
  label: string
  codec: string
  width: number
  height: number
  bitrate: number
  framerate: number
}

const CANDIDATES: Candidate[] = [
  {
    label: '1080p30 avc1.420028',
    codec: 'avc1.420028',
    width: 1920,
    height: 1080,
    bitrate: BITRATE,
    framerate: FPS,
  },
  {
    label: '1080p30 avc1.640028',
    codec: 'avc1.640028',
    width: 1920,
    height: 1080,
    bitrate: BITRATE,
    framerate: FPS,
  },
  {
    label: '1080p30 avc1.4d0028',
    codec: 'avc1.4d0028',
    width: 1920,
    height: 1080,
    bitrate: BITRATE,
    framerate: FPS,
  },
  {
    label: '720p30 avc1.42001f',
    codec: 'avc1.42001f',
    width: 1280,
    height: 720,
    bitrate: BITRATE,
    framerate: FPS,
  },
]

interface ProbeResult {
  status: 'running' | 'completed' | 'failed'
  environment: Record<string, unknown>
  support: Array<{ label: string; config: VideoEncoderConfig; supported: boolean; error?: string }>
  failurePaths?: Array<{ label: string; config: Record<string, unknown>; supported: boolean | null; error: string | null }>
  chosen?: Candidate & { encodedFrames: number; keyFrames: number }
  file?: {
    bytes: number
    base64: string
    mimeType: string
    frames: number
    firstTimestampUs: number
    lastEndTimestampUs: number
  }
  playback?: {
    width: number
    height: number
    duration: number
    currentTimeAfterPlay: number
    seekTarget: number
    currentTimeAfterSeek: number
    seekFrameNonBlack: boolean
    contactFramePng?: string
    resultFramePng?: string
  }
  timings?: { renderAndEncodeMs: number; muxMs: number }
  error?: string
  log: string[]
}

const result: ProbeResult = {
  status: 'running',
  environment: {},
  support: [],
  log: [],
}

declare global {
  interface Window {
    __mp4Probe: ProbeResult
  }
}

const logElement = document.getElementById('log') as HTMLPreElement
const player = document.getElementById('player') as HTMLVideoElement

function log(message: string) {
  result.log.push(message)
  logElement.textContent = result.log.join('\n')
}

window.__mp4Probe = result

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

function describeEnvironment() {
  const canvas = document.createElement('canvas')
  const gl =
    canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info') ?? null
  result.environment = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    devicePixelRatio: window.devicePixelRatio,
    isSecureContext: window.isSecureContext,
    origin: location.origin,
    hasVideoEncoder: typeof VideoEncoder !== 'undefined',
    hasVideoFrame: typeof VideoFrame !== 'undefined',
    hasWebGL: Boolean(gl),
    webglVendor: debugInfo ? gl?.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
    webglRenderer: debugInfo ? gl?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
    hardwareConcurrency: navigator.hardwareConcurrency,
  }
}

async function probeSupport() {
  for (const candidate of CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec: candidate.codec,
      width: candidate.width,
      height: candidate.height,
      bitrate: candidate.bitrate,
      framerate: candidate.framerate,
    }
    try {
      const support = await VideoEncoder.isConfigSupported(config)
      result.support.push({
        label: candidate.label,
        config,
        supported: Boolean(support.supported),
      })
    } catch (error) {
      result.support.push({
        label: candidate.label,
        config,
        supported: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })
    }
  }
  for (const entry of result.support) {
    log(`isConfigSupported ${entry.label}: ${entry.supported}${entry.error ? ` (${entry.error})` : ''}`)
  }
}

/** 记录不可用配置的真实反馈，供后续提示文案使用。 */
async function probeFailurePaths() {
  const configs: Array<{ label: string; config: VideoEncoderConfig }> = [
    {
      label: '不存在的编码字符串',
      config: { codec: 'avc1.ffffff', width: 1920, height: 1080, bitrate: BITRATE, framerate: FPS },
    },
    {
      label: 'HEVC 编码',
      config: { codec: 'hvc1.1.6.L93.B0', width: 1920, height: 1080, bitrate: BITRATE, framerate: FPS },
    },
  ]
  result.failurePaths = []
  for (const entry of configs) {
    try {
      const support = await VideoEncoder.isConfigSupported(entry.config)
      result.failurePaths.push({
        label: entry.label,
        config: { ...entry.config },
        supported: Boolean(support.supported),
        error: null,
      })
    } catch (error) {
      result.failurePaths.push({
        label: entry.label,
        config: { ...entry.config },
        supported: null,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })
    }
  }
  for (const entry of result.failurePaths) {
    log(`失败路径 ${entry.label}: supported=${String(entry.supported)}${entry.error ? ` error=${entry.error}` : ''}`)
  }
}

interface EncodedOutput {
  buffer: ArrayBuffer
  frames: number
  keyFrames: number
  firstTimestampUs: number
  lastEndTimestampUs: number
  renderAndEncodeMs: number
  muxMs: number
}

async function encodeReplay(): Promise<EncodedOutput> {
  // 按优先级取第一个被支持的配置；1080p 全部不可用时降级到 720p。
  const chosenEntry = result.support.find((entry) => entry.supported)
  const candidate = CANDIDATES.find((item) => item.label === chosenEntry?.label)
  if (!chosenEntry || !candidate) {
    throw new Error('没有可用的 H.264 编码配置：' + JSON.stringify(result.support.map((s) => [s.label, s.supported, s.error ?? ''])))
  }

  const input = buildReplayInput('doubles', LANDING, INCOMING)
  if (!input) throw new Error('固定输入未产生有效回放输入')

  const canvas = document.createElement('canvas')
  canvas.width = candidate.width
  canvas.height = candidate.height
  const scene = createReplayScene(canvas, 'green', { pixelRatio: 1 })
  scene.resize(candidate.width, candidate.height)
  if (canvas.width !== candidate.width || canvas.height !== candidate.height) {
    throw new Error(`画布尺寸 ${canvas.width}x${canvas.height} 与目标 ${candidate.width}x${candidate.height} 不一致`)
  }
  log(`画布实际像素 ${canvas.width}x${canvas.height}，DPR=${window.devicePixelRatio}`)

  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const source = new EncodedVideoPacketSource('avc')
  output.addVideoTrack(source, { frameRate: FPS })
  await output.start()

  const config: VideoEncoderConfig = {
    codec: candidate.codec,
    width: candidate.width,
    height: candidate.height,
    bitrate: candidate.bitrate,
    framerate: FPS,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  }

  let frames = 0
  let keyFrames = 0
  let firstTimestampUs = -1
  let lastEndTimestampUs = 0
  let encoderError: Error | null = null
  let writeChain: Promise<void> = Promise.resolve()
  let muxError: Error | null = null

  const encoder = new VideoEncoder({
    output: (chunk, meta: EncodedVideoChunkMetadata | undefined) => {
      frames += 1
      if (chunk.type === 'key') keyFrames += 1
      if (firstTimestampUs < 0) firstTimestampUs = chunk.timestamp
      lastEndTimestampUs = Math.max(lastEndTimestampUs, chunk.timestamp + (chunk.duration ?? 0))
      const packet = EncodedPacket.fromEncodedChunk(chunk)
      // 串行写入，保持编码顺序；封装异常必须冒泡到最终结果。
      writeChain = writeChain.then(() => source.add(packet, meta)).catch((error: unknown) => {
        muxError = error instanceof Error ? error : new Error(String(error))
      })
    },
    error: (error) => {
      encoderError = error instanceof Error ? error : new Error(String(error))
    },
  })
  encoder.configure(config)

  const renderStart = performance.now()
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const time = index / FPS
    scene.render(evaluateReplay(input, time))
    const timestamp = Math.round((index * 1_000_000) / FPS)
    const nextTimestamp = Math.round(((index + 1) * 1_000_000) / FPS)
    const videoFrame = new VideoFrame(canvas, {
      timestamp,
      duration: nextTimestamp - timestamp,
    })
    encoder.encode(videoFrame, { keyFrame: index % FPS === 0 })
    videoFrame.close()

    if (encoder.encodeQueueSize > 8) {
      await new Promise<void>((resolve) => {
        const onDequeue = () => {
          encoder.removeEventListener('dequeue', onDequeue)
          resolve()
        }
        encoder.addEventListener('dequeue', onDequeue)
      })
    }
    if (encoderError) throw encoderError
  }

  await encoder.flush()
  encoder.close()
  if (encoderError) throw encoderError
  await writeChain
  if (muxError) throw muxError
  const renderAndEncodeMs = performance.now() - renderStart

  source.close()
  const muxStart = performance.now()
  await output.finalize()
  const muxMs = performance.now() - muxStart

  scene.dispose()

  if (!target.buffer) throw new Error('封装完成但没有输出缓冲')
  if (frames !== FRAME_COUNT) {
    throw new Error(`编码帧数 ${frames} 与预期 ${FRAME_COUNT} 不一致`)
  }

  result.chosen = { ...candidate, encodedFrames: frames, keyFrames }
  log(`编码完成：${frames} 帧，关键帧 ${keyFrames} 个，渲染编码 ${Math.round(renderAndEncodeMs)} ms，封装 ${Math.round(muxMs)} ms`)

  return {
    buffer: target.buffer,
    frames,
    keyFrames,
    firstTimestampUs,
    lastEndTimestampUs,
    renderAndEncodeMs,
    muxMs,
  }
}

function waitForEvent(target: EventTarget, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      target.removeEventListener(name, onEvent)
      reject(new Error(`等待 ${name} 超时（${timeoutMs} ms）`))
    }, timeoutMs)
    function onEvent() {
      window.clearTimeout(timer)
      target.removeEventListener(name, onEvent)
      resolve()
    }
    target.addEventListener(name, onEvent)
  })
}

/** 画面上取样，确认不是黑屏；同时导出 PNG 作为肉眼证据。 */
function grabFrame(video: HTMLVideoElement, atLabel: string) {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) return { nonBlack: false, png: undefined }
  context.drawImage(video, 0, 0)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let total = 0
  let bright = 0
  for (let index = 0; index < data.length; index += 4 * 64) {
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]
    total += 1
    if (luminance > 12) bright += 1
  }
  const nonBlack = total > 0 && bright / total > 0.2
  log(`${atLabel}：非黑像素占比 ${(100 * (bright / total)).toFixed(1)}%`)
  return { nonBlack, png: canvas.toDataURL('image/png') }
}

/** 等解码后的新画面真正呈现，再取样，避免读到跳转前的旧帧。 */
function waitForPresentedFrame(video: HTMLVideoElement): Promise<void> {
  if ('requestVideoFrameCallback' in video) {
    return new Promise<void>((resolve) => {
      video.requestVideoFrameCallback(() => resolve())
      window.setTimeout(resolve, 500)
    })
  }
  return new Promise<void>((resolve) => window.setTimeout(resolve, 150))
}

async function verifyPlayback(buffer: ArrayBuffer) {
  const blob = new Blob([buffer], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  player.src = url
  await waitForEvent(player, 'loadedmetadata', 15_000)
  if (player.videoWidth === 0 || player.videoHeight === 0) {
    await waitForEvent(player, 'loadeddata', 15_000)
  }

  const width = player.videoWidth
  const height = player.videoHeight
  const duration = player.duration
  log(`播放器读回：${width}x${height}，时长 ${duration.toFixed(3)} s`)

  const seekTarget = 3.2
  player.currentTime = seekTarget
  await waitForEvent(player, 'seeked', 15_000)
  await waitForPresentedFrame(player)
  const contact = grabFrame(player, '触地 3.2 s')

  player.currentTime = 4.6
  await waitForEvent(player, 'seeked', 15_000)
  await waitForPresentedFrame(player)
  const freeze = grabFrame(player, '定格 4.6 s')

  player.currentTime = 0
  await waitForEvent(player, 'seeked', 15_000)
  await player.play()
  await new Promise((resolve) => window.setTimeout(resolve, 1200))
  const currentTimeAfterPlay = player.currentTime
  player.pause()
  log(`播放 1.2 s 后 currentTime = ${currentTimeAfterPlay.toFixed(3)} s`)

  player.currentTime = seekTarget
  await waitForEvent(player, 'seeked', 15_000)
  const currentTimeAfterSeek = player.currentTime

  URL.revokeObjectURL(url)
  player.removeAttribute('src')
  player.load()

  return {
    width,
    height,
    duration,
    currentTimeAfterPlay,
    seekTarget,
    currentTimeAfterSeek,
    seekFrameNonBlack: contact.nonBlack && freeze.nonBlack,
    contactFramePng: contact.png,
    resultFramePng: freeze.png,
  }
}

async function run() {
  describeEnvironment()
  log(`UA: ${String(result.environment.userAgent)}`)
  log(`Secure Context: ${String(result.environment.isSecureContext)}`)

  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('当前浏览器没有 WebCodecs（VideoEncoder/VideoFrame 缺失）')
  }
  if (!result.environment.hasWebGL) {
    throw new Error('当前环境无法创建 WebGL 上下文，回放场景无法渲染')
  }

  await probeSupport()
  await probeFailurePaths()
  const encoded = await encodeReplay()

  result.file = {
    bytes: encoded.buffer.byteLength,
    base64: toBase64(new Uint8Array(encoded.buffer)),
    mimeType: 'video/mp4',
    frames: encoded.frames,
    firstTimestampUs: encoded.firstTimestampUs,
    lastEndTimestampUs: encoded.lastEndTimestampUs,
  }
  result.timings = {
    renderAndEncodeMs: Math.round(encoded.renderAndEncodeMs),
    muxMs: Math.round(encoded.muxMs),
  }
  log(`文件大小 ${encoded.buffer.byteLength} B`)
  log(`时间戳 ${encoded.firstTimestampUs} µs → ${encoded.lastEndTimestampUs} µs`)

  result.playback = await verifyPlayback(encoded.buffer)
  result.status = 'completed'
  log('验证完成')
}

run().catch((error: unknown) => {
  result.status = 'failed'
  result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  log(`失败：${result.error}`)
})

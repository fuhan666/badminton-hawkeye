import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { CourtPalette } from '../courtColors'
import type { ReplayInput } from '../domain/direction'
import { REPLAY_DURATION, evaluateReplay } from '../domain/replay'
import { createReplayScene } from '../replay/scene'
import type { ReplayScene } from '../replay/scene'

interface ReplayPreviewProps {
  input: ReplayInput
  palette: CourtPalette
  aspect: number
}

export default function ReplayPreview({
  input,
  palette,
  aspect,
}: ReplayPreviewProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<ReplayScene | null>(null)
  const timeRef = useRef(0)
  const colorRef = useRef(palette)
  colorRef.current = palette

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [runId, setRunId] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const frame = useMemo(() => evaluateReplay(input, time, aspect), [input, time, aspect])
  const frameRef = useRef(frame)
  frameRef.current = frame

  function restart() {
    timeRef.current = 0
    setTime(0)
    setRunId((value) => value + 1)
    setPlaying(true)
  }

  // 场景只在挂载时创建一次，卸载时释放几何、材质与渲染器
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return

    let scene: ReplayScene
    try {
      scene = createReplayScene(canvas, colorRef.current)
    } catch {
      setError('当前浏览器无法创建 WebGL 上下文，三维回放不可用。')
      return
    }
    sceneRef.current = scene
    scene.render(frameRef.current)

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      scene.resize(rect.width, rect.height)
      // 尺寸变化会清空绘制缓冲，暂停时也要补画当前帧
      scene.render(frameRef.current)
    })
    observer.observe(stage)
    const rect = stage.getBoundingClientRect()
    scene.resize(rect.width, rect.height)

    return () => {
      observer.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  // 换色只更新材质并补画当前帧，保留时间轴与播放状态。
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setPalette(palette)
    scene.render(frameRef.current)
  }, [palette])

  // 时刻或输入变化时重绘；画面完全由 evaluateReplay 的输出决定
  useEffect(() => {
    sceneRef.current?.render(frame)
  }, [frame])

  // 落点、方向、赛制或高度变化后回零并暂停，用新的输入重新开始
  useEffect(() => {
    timeRef.current = 0
    setTime(0)
    setPlaying(false)
  }, [input])

  // 播放推进：rAF 只负责把真实时间换算成绝对播放秒数，不做逐帧积分
  useEffect(() => {
    if (!playing) return
    const from = timeRef.current >= REPLAY_DURATION - 1e-6 ? 0 : timeRef.current
    if (from === 0) {
      timeRef.current = 0
      setTime(0)
    }
    const startStamp = performance.now()
    let handle = 0

    const tick = (now: number) => {
      const next = from + (now - startStamp) / 1000
      if (next >= REPLAY_DURATION) {
        timeRef.current = REPLAY_DURATION
        setTime(REPLAY_DURATION)
        setPlaying(false)
        return
      }
      timeRef.current = next
      setTime(next)
      handle = requestAnimationFrame(tick)
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, runId])

  function handleSeek(event: ChangeEvent<HTMLInputElement>) {
    const next = Number(event.target.value)
    setPlaying(false)
    timeRef.current = next
    setTime(next)
  }

  const finished = time >= REPLAY_DURATION - 1e-6

  return (
    <div className="replay">
      <div className="replay__stage" ref={stageRef}>
        <canvas className="replay__canvas" ref={canvasRef} />
        {error ? (
          <p className="replay__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="replay__controls">
        <input
          className="replay__range"
          type="range"
          min={0}
          max={REPLAY_DURATION}
          step={0.01}
          value={time}
          aria-label="回放时间轴"
          onChange={handleSeek}
          disabled={Boolean(error)}
        />
        <button
          type="button"
          className="action action--compact"
          onClick={() => setPlaying((value) => !value)}
          disabled={Boolean(error)}
        >
          {playing ? '暂停' : finished ? '重播' : '播放'}
        </button>
        <button type="button" className="link-button" onClick={restart} disabled={Boolean(error)}>
          从头重播
        </button>
        <span className="replay__time">
          {time.toFixed(1)} / {REPLAY_DURATION.toFixed(1)} s
        </span>
      </div>
    </div>
  )
}

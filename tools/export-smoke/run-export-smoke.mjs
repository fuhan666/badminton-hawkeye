// 在真实浏览器里验证正式应用的导出路径：导出、进度、取消、重试、不支持提示。
// 用法：node tools/export-smoke/run-export-smoke.mjs [--browser chrome|edge] [--port 5201]
// 需要本机已安装 Chrome 或 Edge；不引入额外依赖，直接走 CDP。

import { spawn } from 'node:child_process'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outDir = resolve(here, 'out')
const downloadDir = resolve(outDir, 'downloads')

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (token.startsWith('--')) args.set(token.slice(2), process.argv[index + 1] ?? '')
}

const browserName = args.get('browser') ?? 'chrome'
const port = Number(args.get('port') ?? 5201)
const url = `http://127.0.0.1:${port}/`

const BROWSERS = {
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
}
const executable = BROWSERS[browserName]
if (!executable) {
  console.error(`未知浏览器 ${browserName}，可选 chrome / edge`)
  process.exit(2)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function waitForHttp(target, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(target)
      if (response.ok) return response
    } catch {
      // 还没起来
    }
    await sleep(200)
  }
  throw new Error(`等待 ${target} 超时`)
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 1
  const ready = new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = () => resolveOpen()
    socket.onerror = (event) => rejectOpen(new Error(`WebSocket 连接失败：${String(event?.type)}`))
  })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolveCall, rejectCall } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) rejectCall(new Error(message.error.message))
      else resolveCall(message.result)
    }
  }
  return {
    ready,
    send(method, params = {}) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { resolveCall, rejectCall })
      })
    },
    close: () => socket.close(),
  }
}

const children = []
function track(child) {
  children.push(child)
  return child
}

async function stopChildren() {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  await sleep(300)
}

async function listDownloaded() {
  const entries = await readdir(downloadDir).catch(() => [])
  const files = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const info = await stat(resolve(downloadDir, name)).catch(() => null)
    if (info?.isFile()) files.push({ name, bytes: info.size, mtime: info.mtimeMs })
  }
  return files.sort((a, b) => a.mtime - b.mtime)
}

async function waitForStableDownload(previousNames, deadline) {
  while (Date.now() < deadline) {
    const files = await listDownloaded()
    const fresh = files.filter((file) => !previousNames.has(file.name) && /\.mp4$/i.test(file.name))
    const partial = files.some((file) => !previousNames.has(file.name) && /\.crdownload$/i.test(file.name))
    if (fresh.length > 0 && !partial) return fresh[0]
    await sleep(200)
  }
  throw new Error('等待下载文件超时')
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(downloadDir, { recursive: true })

  const vite = track(
    spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  let viteLog = ''
  vite.stdout.on('data', (chunk) => {
    viteLog += chunk.toString()
  })
  vite.stderr.on('data', (chunk) => {
    viteLog += chunk.toString()
  })
  const viteDeadline = Date.now() + 30_000
  while (Date.now() < viteDeadline) {
    try {
      const response = await fetch(url)
      if (response.ok) break
    } catch {
      // 继续等
    }
    await sleep(200)
  }

  const profile = resolve(outDir, `${browserName}-profile`)
  const browser = track(
    spawn(
      executable,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--hide-scrollbars',
        '--mute-audio',
        '--enable-unsafe-swiftshader',
        '--window-size=1280,1000',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    ),
  )

  const wsEndpoint = await new Promise((resolveEndpoint, rejectEndpoint) => {
    let buffer = ''
    const timer = setTimeout(() => rejectEndpoint(new Error('浏览器未在 30 s 内启动')), 30_000)
    browser.stderr.on('data', (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) {
        clearTimeout(timer)
        resolveEndpoint(match[1])
      }
    })
    browser.on('exit', (code) => {
      clearTimeout(timer)
      rejectEndpoint(new Error(`浏览器提前退出，code=${code}\n${buffer.slice(-2000)}`))
    })
  })

  const debugPort = new URL(wsEndpoint).port
  const version = await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, Date.now() + 10_000).then(
    (response) => response.json(),
  )
  const targets = await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`, Date.now() + 10_000).then(
    (response) => response.json(),
  )
  const pageTarget = targets.find((target) => target.type === 'page')
  if (!pageTarget) throw new Error('没有找到可用的页面 target')

  const cdp = connect(pageTarget.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const evaluate = async (expression) => {
    const reply = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (reply.exceptionDetails) {
      throw new Error(`页面内取值失败：${reply.exceptionDetails.text ?? reply.exceptionDetails.exception?.description}`)
    }
    return reply.result?.value
  }

  async function clickSelector(selector) {
    const box = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    })()`)
    await sleep(150)
    if (!box) throw new Error(`找不到可点击元素 ${selector}`)
    const { x, y } = JSON.parse(box)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  async function clickCourt(fractionX, fractionY) {
    const box = await evaluate(`(() => {
      const svg = document.querySelector('.court-view--full');
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return JSON.stringify({ x: rect.left + rect.width * ${fractionX}, y: rect.top + rect.height * ${fractionY} });
    })()`)
    if (!box) throw new Error('找不到全场球场')
    const { x, y } = JSON.parse(box)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  const statusExpression = `(() => {
    const bar = document.querySelector('.export-bar');
    const track = bar?.querySelector('[role="progressbar"]');
    const buttons = [...document.querySelectorAll('.actions .action')];
    const exportButton = buttons.at(-1);
    return JSON.stringify({
      phase: bar?.dataset.exportPhase ?? null,
      percent: track ? Number(track.getAttribute('aria-valuenow')) : null,
      message: bar?.querySelector('.export-bar__message')?.textContent ?? null,
      exportDisabled: exportButton ? exportButton.disabled : null,
      exportLabel: exportButton?.textContent ?? null,
      verdict: document.querySelector('.verdict .verdict__value')?.textContent ?? null,
      previewCanvas: Boolean(document.querySelector('.replay canvas, .replay__stage canvas, canvas')),
    });
  })()`
  const readStatus = async () => JSON.parse(await evaluate(statusExpression))

  async function setPoints() {
    await evaluate(`[...document.querySelectorAll('.target-switch__button')].find((button) => button.textContent.trim() === '来向点')?.click()`)
    await clickCourt(0.62, 0.52)
    await sleep(200)
    await clickCourt(0.38, 0.42)
    await sleep(400)
  }

  async function waitForPhase(phases, deadline) {
    const samples = []
    while (Date.now() < deadline) {
      const status = await readStatus()
      samples.push(status)
      if (phases.includes(status.phase)) return { status, samples }
      await sleep(80)
    }
    const last = samples.at(-1)
    throw new Error(`等待状态 ${phases.join('/')} 超时，当前 ${JSON.stringify(last)}`)
  }

  async function screenshot(name) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(resolve(outDir, name), Buffer.from(shot.data, 'base64'))
  }

  async function capturePreviewFrame(name, time) {
    await evaluate(`(() => {
      const input = document.querySelector('.replay__range');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(String(time))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    await sleep(350)
    const box = JSON.parse(
      await evaluate(`(() => {
        const stage = document.querySelector('.replay__stage');
        stage.scrollIntoView({ block: 'center' });
        const rect = stage.getBoundingClientRect();
        return JSON.stringify({
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        });
      })()`),
    )
    await sleep(400)
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { ...box, scale: 1 },
    })
    await writeFile(resolve(outDir, name), Buffer.from(shot.data, 'base64'))
  }

  const report = {
    browser: {
      name: browserName,
      product: version.Browser,
      userAgent: version['User-Agent'],
      executable,
      headless: true,
    },
    generatedAt: new Date().toISOString(),
    url,
    node: process.version,
    runs: {},
  }

  try {
    // 下载保存到本次产物目录，便于 ffprobe 与人工核对
    try {
      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
        eventsEnabled: true,
      })
    } catch {
      await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
    }

    await cdp.send('Page.navigate', { url })
    await sleep(1500)
    await setPoints()

    const ready = await readStatus()
    if (ready.exportDisabled) throw new Error(`设定来向点后导出按钮仍禁用：${JSON.stringify(ready)}`)
    report.runs.ready = ready

    // 第一次导出：走完整成功路径
    const before = new Set((await listDownloaded()).map((file) => file.name))
    await clickSelector('.actions .action--primary')
    const progressSamples = []
    const progressDeadline = Date.now() + 240_000
    while (Date.now() < progressDeadline) {
      const status = await readStatus()
      progressSamples.push({ phase: status.phase, percent: status.percent })
      if (status.phase === 'done' || status.phase === 'error' || status.phase === 'unsupported') break
      await sleep(100)
    }
    const doneStatus = await readStatus()
    if (doneStatus.phase !== 'done') {
      throw new Error(`导出未完成：${JSON.stringify(doneStatus)}`)
    }
    await screenshot('export-done.png')

    const downloaded = await waitForStableDownload(before, Date.now() + 30_000)
    const sampleName = 'sample-app-export.mp4'
    await rename(resolve(downloadDir, downloaded.name), resolve(outDir, sampleName))
    await capturePreviewFrame('preview-3.2s.png', 3.2)
    await capturePreviewFrame('preview-4.6s.png', 4.6)
    report.runs.success = {
      status: doneStatus,
      percentRange: {
        min: Math.min(...progressSamples.map((item) => item.percent ?? 0)),
        max: Math.max(...progressSamples.map((item) => item.percent ?? 0)),
      },
      distinctPercents: [...new Set(progressSamples.map((item) => item.percent))].slice(0, 40),
      phases: [...new Set(progressSamples.map((item) => item.phase))],
      download: { name: downloaded.name, bytes: downloaded.bytes, savedAs: sampleName },
    }

    // 第二次导出：中途取消，确认无新下载，随后重试成功
    const beforeCancel = new Set((await listDownloaded()).map((file) => file.name))
    await clickSelector('.actions .action--primary')
    const started = await waitForPhase(['encoding', 'muxing'], Date.now() + 30_000)
    await sleep(120)
    const beforeCancelStatus = await readStatus()
    await evaluate(`[...document.querySelectorAll('.export-bar button')].find((button) => button.textContent.includes('取消'))?.click()`)
    const cancelled = await waitForPhase(['cancelled'], Date.now() + 20_000)
    await screenshot('export-cancelled.png')
    await sleep(1500)
    const afterCancelFiles = (await listDownloaded()).filter((file) => !beforeCancel.has(file.name))
    if (afterCancelFiles.length > 0) {
      throw new Error(`取消后仍产生了文件：${afterCancelFiles.map((file) => file.name).join(', ')}`)
    }
    report.runs.cancel = {
      startedStatus: started.status,
      beforeCancelStatus,
      cancelledStatus: cancelled.status,
      residualDownloads: afterCancelFiles.length,
      exportDisabledAfterCancel: (await readStatus()).exportDisabled,
    }

    const beforeRetry = new Set((await listDownloaded()).map((file) => file.name))
    await clickSelector('.actions .action--primary')
    const retryDone = await waitForPhase(['done', 'error'], Date.now() + 240_000)
    if (retryDone.status.phase !== 'done') throw new Error(`取消后重试失败：${JSON.stringify(retryDone.status)}`)
    const retryDownload = await waitForStableDownload(beforeRetry, Date.now() + 30_000)
    report.runs.retryAfterCancel = {
      status: retryDone.status,
      download: { name: retryDownload.name, bytes: retryDownload.bytes },
    }

    // OUT 分支：把落点移到场外，导出结果牌应为 OUT
    await evaluate(`[...document.querySelectorAll('.target-switch__button')].find((button) => button.textContent.trim() === '落点')?.click()`)
    let outStatus = null
    for (const [fx, fy] of [[0.08, 0.12], [0.92, 0.12], [0.08, 0.88], [0.92, 0.88]]) {
      await clickCourt(fx, fy)
      await sleep(250)
      outStatus = await readStatus()
      if (outStatus.verdict === 'OUT') break
    }
    if (outStatus?.verdict !== 'OUT') throw new Error(`未能设置 OUT 落点：${JSON.stringify(outStatus)}`)

    const beforeOut = new Set((await listDownloaded()).map((file) => file.name))
    await clickSelector('.actions .action--primary')
    const outDone = await waitForPhase(['done', 'error', 'unsupported'], Date.now() + 240_000)
    if (outDone.status.phase !== 'done') throw new Error(`OUT 导出失败：${JSON.stringify(outDone.status)}`)
    const outDownload = await waitForStableDownload(beforeOut, Date.now() + 30_000)
    await rename(resolve(downloadDir, outDownload.name), resolve(outDir, 'sample-out-export.mp4'))
    await capturePreviewFrame('preview-out-4.6s.png', 4.6)
    report.runs.outResult = {
      landingVerdict: outDone.status.verdict,
      status: outDone.status,
      download: { name: outDownload.name, bytes: outDownload.bytes, savedAs: 'sample-out-export.mp4' },
    }

    // 不支持环境：移除 VideoEncoder 后重新加载，导出应给出明确提示且预览正常
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { Object.defineProperty(window, 'VideoEncoder', { configurable: true, get: () => undefined }); } catch {}`,
    })
    await cdp.send('Page.reload', { ignoreCache: true })
    await sleep(1800)
    await setPoints()
    await clickSelector('.actions .action--primary')
    const unsupported = await waitForPhase(['unsupported', 'error'], Date.now() + 30_000)
    await screenshot('export-unsupported.png')
    report.runs.unsupported = {
      status: unsupported.status,
      previewCanvas: unsupported.status.previewCanvas,
    }
    if (unsupported.status.phase !== 'unsupported') {
      throw new Error(`缺少 VideoEncoder 时未给出“不支持”提示：${JSON.stringify(unsupported.status)}`)
    }

    await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    cdp.close()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exitCode = 1
} finally {
  await stopChildren()
}

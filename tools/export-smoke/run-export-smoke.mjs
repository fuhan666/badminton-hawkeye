// 在真实浏览器里验证正式应用：固定米制输入逐项走判定，再走导出、取消、重试与不支持提示。
// 用法：node tools/export-smoke/run-export-smoke.mjs [--browser chrome|edge] [--port 5201] [--server dev|preview]
// --server preview 会先读取 dist/ 的构建产物，验证生产构建的导出路径。
// 需要本机已安装 Chrome 或 Edge；不引入额外依赖，直接走 CDP。
// 所有落点与来向点都通过界面点击 + 方向键微调设到毫米整数，不按外框比例猜位置。

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outDir = resolve(here, 'out')
const downloadDir = resolve(outDir, 'downloads')
const sampleDir = resolve(outDir, 'samples')

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (token.startsWith('--')) args.set(token.slice(2), process.argv[index + 1] ?? '')
}

const browserName = args.get('browser') ?? 'chrome'
const port = Number(args.get('port') ?? 5201)
const serverName = args.get('server') ?? 'dev'
if (!['dev', 'preview'].includes(serverName)) {
  console.error(`未知服务 ${serverName}，可选 dev / preview`)
  process.exit(2)
}
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
    // 只关心本应用的 MP4 半成品；Chrome 自身组件的 .crdownload 与导出无关
    const partial = files.some((file) => !previousNames.has(file.name) && /\.mp4\.crdownload$/i.test(file.name))
    if (fresh.length > 0 && !partial) return fresh[0]
    await sleep(200)
  }
  throw new Error('等待下载文件超时')
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(downloadDir, { recursive: true })
  await mkdir(sampleDir, { recursive: true })

  const viteCommand =
    serverName === 'preview'
      ? ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
      : ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  const vite = track(
    spawn('npx', viteCommand, {
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
        '--disable-component-update',
        '--disable-background-networking',
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

  /** 米制坐标 → 屏幕坐标，用 SVG 自己的 CTM，不按外框比例估算。 */
  async function clientForMeter(x, z) {
    const box = await evaluate(`(() => {
      const svg = document.querySelector('.court-view--full');
      if (!svg) return null;
      svg.scrollIntoView({ block: 'center' });
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = svg.createSVGPoint();
      point.x = ${x};
      point.y = ${z};
      const screen = point.matrixTransform(matrix);
      return JSON.stringify({ x: screen.x, y: screen.y });
    })()`)
    if (!box) throw new Error('找不到全场球场或坐标变换')
    await sleep(80)
    return JSON.parse(box)
  }

  async function pressAt(x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 1, y: y + 1, button: 'left' })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 1, y: y + 1, button: 'left', clickCount: 1 })
    await sleep(120)
  }

  async function pressKey(key, shift) {
    const codes = {
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
    }
    const params = {
      key,
      code: key,
      windowsVirtualKeyCode: codes[key],
      nativeVirtualKeyCode: codes[key],
      modifiers: shift ? 8 : 0,
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  }

  const readoutExpression = `(() => {
    const values = [...document.querySelectorAll('.readout dd')].map((node) => node.textContent.trim());
    return JSON.stringify(values);
  })()`

  /** 当前落点毫米读数（界面读数即判定所用值）。 */
  async function readLandingMillimetres() {
    const values = JSON.parse(await evaluate(readoutExpression))
    const numbers = values
      .slice(0, 2)
      .map((text) => Number(String(text).replace(/[^-\d]/g, '')))
    if (numbers.length < 2 || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error(`无法读取落点读数：${JSON.stringify(values)}`)
    }
    return { xMm: numbers[0], zMm: numbers[1] }
  }

  /** 手柄圆心的精确米制坐标（与判定共用同一状态，圆半径不参与）。 */
  async function readHandleMillimetres(target) {
    const role = target === 'incoming' ? 'incoming-handle' : 'landing-handle'
    const box = await evaluate(`(() => {
      const node = document.querySelector('[data-role="${role}"]');
      if (!node) return null;
      return JSON.stringify({ cx: node.getAttribute('cx'), cy: node.getAttribute('cy') });
    })()`)
    if (!box) throw new Error(`找不到 ${role}`)
    const { cx, cy } = JSON.parse(box)
    return { xMm: Math.round(Number(cx) * 1000), zMm: Math.round(Number(cy) * 1000) }
  }

  async function selectTarget(target) {
    const label = target === 'incoming' ? '来向点' : '落点'
    await evaluate(`[...document.querySelectorAll('.target-switch__button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)})?.click()`)
    await sleep(120)
  }

  /**
   * 把某个点放到指定位（米，毫米精度）：先用 SVG CTM 点击定位，
   * 再用方向键按毫米收敛。落点另外用判定面板读数交叉核对。
   */
  async function placePoint(target, x, z) {
    await selectTarget(target)
    const client = await clientForMeter(x, z)
    await pressAt(client.x, client.y)

    const wantX = Math.round(x * 1000)
    const wantZ = Math.round(z * 1000)
    let actual = await readHandleMillimetres(target)
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const dx = wantX - actual.xMm
      const dz = wantZ - actual.zMm
      if (dx === 0 && dz === 0) break
      if (dx !== 0) {
        if (Math.abs(dx) >= 10) await pressKey(dx > 0 ? 'ArrowRight' : 'ArrowLeft', true)
        else await pressKey(dx > 0 ? 'ArrowRight' : 'ArrowLeft', false)
      } else if (Math.abs(dz) >= 10) {
        await pressKey(dz > 0 ? 'ArrowDown' : 'ArrowUp', true)
      } else {
        await pressKey(dz > 0 ? 'ArrowDown' : 'ArrowUp', false)
      }
      actual = await readHandleMillimetres(target)
    }
    if (actual.xMm !== wantX || actual.zMm !== wantZ) {
      throw new Error(`${target} 未收敛到 ${wantX},${wantZ} mm，实际 ${actual.xMm},${actual.zMm} mm`)
    }
    if (target === 'landing') {
      const panel = await readLandingMillimetres()
      if (panel.xMm !== wantX || panel.zMm !== wantZ) {
        throw new Error(`落点读数与手柄不一致：面板 ${panel.xMm},${panel.zMm} mm`)
      }
    }
    return actual
  }

  const statusExpression = `(() => {
    const bar = document.querySelector('.export-bar');
    const track = bar?.querySelector('[role="progressbar"]');
    const buttons = [...document.querySelectorAll('.actions .action')];
    const exportButton = buttons.at(-1);
    const readout = [...document.querySelectorAll('.readout dd')].map((node) => node.textContent.trim());
    const incoming = document.querySelector('[data-role="incoming-handle"]');
    return JSON.stringify({
      phase: bar?.dataset.exportPhase ?? null,
      percent: track ? Number(track.getAttribute('aria-valuenow')) : null,
      message: bar?.querySelector('.export-bar__message')?.textContent ?? null,
      exportDisabled: exportButton ? exportButton.disabled : null,
      exportLabel: exportButton?.textContent ?? null,
      verdict: document.querySelector('.verdict .verdict__value')?.textContent ?? null,
      previewCanvas: Boolean(document.querySelector('.replay canvas, .replay__stage canvas, canvas')),
      format: [...document.querySelectorAll('.format__button')].find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent?.trim() ?? null,
      landingMm: readout.slice(0, 2),
      incomingMm: incoming ? { x: Math.round(Number(incoming.getAttribute('cx')) * 1000), z: Math.round(Number(incoming.getAttribute('cy')) * 1000) } : null,
      downloadLabel: buttons.at(-1)?.textContent ?? null,
    });
  })()`
  const readStatus = async () => JSON.parse(await evaluate(statusExpression))

  async function setFormat(format) {
    const label = format === 'singles' ? '单打' : '双打'
    await evaluate(`[...document.querySelectorAll('.format__button')].find((button) => button.textContent.includes(${JSON.stringify(label)}))?.click()`)
    await sleep(200)
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
    const buffer = Buffer.from(shot.data, 'base64')
    await writeFile(resolve(outDir, name), buffer)
    return createHash('sha256').update(buffer).digest('hex')
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
    server: serverName,
    node: process.version,
    scenarios: [],
    samples: [],
    previewVsVideo: null,
    runs: {},
    failures: [],
  }

  async function recordScenario(name, expected, { format = 'doubles' } = {}) {
    const status = await readStatus()
    const actualVerdict = status.verdict
    const pass = actualVerdict === expected
    const entry = {
      name,
      format,
      expected,
      actual: actualVerdict,
      landingMm: status.landingMm,
      pass,
    }
    report.scenarios.push(entry)
    if (!pass) report.failures.push(`场景「${name}」预期 ${expected}，实际 ${actualVerdict}（${JSON.stringify(status.landingMm)}）`)
    return entry
  }

  /** 导出一次保存到指定文件，返回实际下载名、字节数与进度采样。 */
  async function exportOnce(saveRelativePath, deadline = Date.now() + 300_000) {
    const before = new Set((await listDownloaded()).map((file) => file.name))
    const startedAt = Date.now()
    await clickSelector('.actions .action--primary')
    const progress = []
    while (Date.now() < deadline) {
      const status = await readStatus()
      progress.push(status.percent)
      if (['done', 'error', 'unsupported', 'cancelled'].includes(status.phase)) break
      await sleep(100)
    }
    const done = await readStatus()
    if (done.phase !== 'done') throw new Error(`导出未完成：${JSON.stringify(done)}`)
    const downloaded = await waitForStableDownload(before, Date.now() + 30_000)
    const targetPath = resolve(outDir, saveRelativePath)
    await rename(resolve(downloadDir, downloaded.name), targetPath)
    const info = await stat(targetPath)
    const entry = {
      file: saveRelativePath,
      downloadedName: downloaded.name,
      bytes: info.size,
      elapsedMs: Date.now() - startedAt,
      percentRange: [Math.min(...progress.filter(Number.isFinite)), Math.max(...progress.filter(Number.isFinite))],
      verdict: done.verdict,
    }
    report.samples.push(entry)
    return entry
  }

  async function resetPage() {
    await cdp.send('Page.navigate', { url })
    await sleep(1600)
  }

  try {
    try {
      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
        eventsEnabled: true,
      })
    } catch {
      await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
    }

    await resetPage()

    // ---- 固定输入场景：全部通过界面设置，读数取自面板 ----
    await placePoint('landing', 2.2, 3.2)
    await placePoint('incoming', 2.2, 0)
    await recordScenario('场内（双打 2.200, 3.200）', 'IN')
    await capturePreviewFrame('preview-inside-3.2s.png', 3.2)

    await setFormat('singles')
    await placePoint('landing', 2.7, 3.2)
    await recordScenario('同点切换赛制：单打（2.700, 3.200）', 'OUT', { format: 'singles' })
    await setFormat('doubles')
    await recordScenario('同点切换赛制：双打（2.700, 3.200）', 'IN')
    await screenshot('scenario-format-switch.png')

    await placePoint('landing', 3.055, 3.2)
    await recordScenario('部分压线（双打 3.055, 3.200）', 'IN')
    await screenshot('scenario-line-in.png')

    await placePoint('landing', 3.063, 3.2)
    await recordScenario('外沿相切（双打 3.063, 3.200）', 'IN')

    await placePoint('landing', 3.064, 3.2)
    await recordScenario('完全出界（双打 3.064, 3.200）', 'OUT')
    await screenshot('scenario-out.png')

    await placePoint('landing', 3.055, 6.705)
    await placePoint('incoming', 3.055, 3.505)
    await recordScenario('角落相交（双打 3.055, 6.705）', 'IN')
    await screenshot('scenario-corner-in.png')

    await placePoint('landing', 3.06, 6.71)
    await recordScenario('角落外沿（双打 3.060, 6.710）', 'OUT')

    // 同方向不同距离：来向点 (3.055, 0) 与 (3.055, -3.2)，单位方向都是 (0, 1)
    await placePoint('landing', 3.055, 3.2)
    await placePoint('incoming', 3.055, 0)
    const nearDirection = await readStatus()
    const nearHash = await capturePreviewFrame('same-direction-near-3.2s.png', 3.2)
    await placePoint('incoming', 3.055, -3.2)
    const farDirection = await readStatus()
    const farHash = await capturePreviewFrame('same-direction-far-3.2s.png', 3.2)
    const sameDirection = {
      near: { landingMm: nearDirection.landingMm, incomingMm: nearDirection.incomingMm },
      far: { landingMm: farDirection.landingMm, incomingMm: farDirection.incomingMm },
      previewHashEqual: nearHash === farHash,
      nearHash,
      farHash,
    }
    report.sameDirection = sameDirection
    report.scenarios.push({
      name: '同方向不同距离（来向 3.055,0 与 3.055,-3.2）',
      expected: '相同回放画面',
      actual: `画面哈希${nearHash === farHash ? '相同' : '不同'}`,
      pass: nearHash === farHash,
    })
    if (report.scenarios.at(-1).pass === false) report.failures.push('同方向不同距离的回放画面不一致')

    // ---- 样片：固定输入走正式导出按钮 ----
    async function prepare(format, landingX, landingZ) {
      await setFormat(format)
      await placePoint('landing', landingX, landingZ)
      await placePoint('incoming', landingX, landingZ - 3.2)
      const status = await readStatus()
      return status
    }

    // 双打压线 IN：同时作为成功路径与预览/视频一致性样本
    let status = await prepare('doubles', 3.055, 3.2)
    if (status.verdict !== 'IN') throw new Error(`样片输入判定不符：${JSON.stringify(status)}`)
    const previewNear = {
      t32: await capturePreviewFrame('preview-3.2s.png', 3.2),
      t46: await capturePreviewFrame('preview-4.6s.png', 4.6),
    }
    await exportOnce('samples/doubles-line-in.mp4')
    await screenshot('export-done.png')
    report.runs.success = {
      status: await readStatus(),
      downloadFile: 'samples/doubles-line-in.mp4',
    }

    // 双打完全出界 OUT
    status = await prepare('doubles', 3.075, 3.2)
    if (status.verdict !== 'OUT') throw new Error(`样片输入判定不符：${JSON.stringify(status)}`)
    await capturePreviewFrame('preview-out-4.6s.png', 4.6)
    await exportOnce('samples/doubles-out.mp4')

    // 单打压线 IN
    status = await prepare('singles', 2.595, 3.2)
    if (status.verdict !== 'IN') throw new Error(`样片输入判定不符：${JSON.stringify(status)}`)
    await exportOnce('samples/singles-line-in.mp4')

    // 双打角落 IN
    status = await prepare('doubles', 3.055, 6.705)
    if (status.verdict !== 'IN') throw new Error(`样片输入判定不符：${JSON.stringify(status)}`)
    await exportOnce('samples/doubles-corner-in.mp4')

    report.previewVsVideo = {
      input: { format: 'doubles', landing: [3.055, 3.2], incoming: [3.055, 0] },
      video: 'samples/doubles-line-in.mp4',
      previewFrames: previewNear,
    }

    // ---- 取消与重试 ----
    status = await prepare('doubles', 3.075, 3.2)
    const beforeCancel = new Set((await listDownloaded()).map((file) => file.name))
    await clickSelector('.actions .action--primary')
    const started = await waitForPhase(['encoding', 'muxing'], Date.now() + 30_000)
    await sleep(150)
    const beforeCancelStatus = await readStatus()
    await evaluate(`[...document.querySelectorAll('.export-bar button')].find((button) => button.textContent.includes('取消'))?.click()`)
    const cancelled = await waitForPhase(['cancelled'], Date.now() + 20_000)
    await screenshot('export-cancelled.png')
    await sleep(1500)
    const afterCancelFiles = (await listDownloaded()).filter(
      (file) => !beforeCancel.has(file.name) && /\.mp4(\.crdownload)?$/i.test(file.name),
    )
    if (afterCancelFiles.length > 0) {
      throw new Error(`取消后仍产生了文件：${afterCancelFiles.map((file) => file.name).join(', ')}`)
    }
    const afterCancelStatus = await readStatus()
    report.runs.cancel = {
      startedStatus: started.status,
      beforeCancelStatus,
      cancelledStatus: cancelled.status,
      residualDownloads: afterCancelFiles.length,
      exportDisabledAfterCancel: afterCancelStatus.exportDisabled,
      exportLabelAfterCancel: afterCancelStatus.exportLabel,
    }
    if (afterCancelStatus.exportDisabled) {
      report.failures.push('取消后导出按钮仍处于禁用状态')
    }

    const retry = await exportOnce('cancel-retry.mp4')
    report.runs.retryAfterCancel = { status: await readStatus(), download: retry }

    // ---- 不支持编码能力 ----
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { Object.defineProperty(window, 'VideoEncoder', { configurable: true, get: () => undefined }); } catch {}`,
    })
    await resetPage()
    await placePoint('landing', 2.2, 3.2)
    await placePoint('incoming', 2.2, 0)
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
    if (report.failures.length > 0) {
      console.error(`\n失败项 ${report.failures.length}：`)
      for (const failure of report.failures) console.error(`- ${failure}`)
      process.exitCode = 1
    }
  } catch (error) {
    await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))
    throw error
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

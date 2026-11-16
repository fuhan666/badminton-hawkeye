// 在真实浏览器中跑一次 MP4 导出验证，保存样片、关键帧截图与报告。
// 用法：node tools/mp4-probe/run-probe.mjs [--browser chrome|edge] [--port 5199]
// 需要本机已安装 Chrome 或 Edge；不引入额外依赖，直接走 CDP。

import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, 'out')

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (token.startsWith('--')) args.set(token.slice(2), process.argv[index + 1] ?? '')
}

const browserName = args.get('browser') ?? 'chrome'
const port = Number(args.get('port') ?? 5199)
const url = `http://127.0.0.1:${port}/tools/mp4-probe/index.html`

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
      if (response.ok) return await response.json()
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
    if (child.exitCode === null) {
      child.kill('SIGTERM')
    }
  }
  await sleep(300)
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const vite = track(
    spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: resolve(here, '../..'),
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
        '--window-size=1280,900',
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
  const version = await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, Date.now() + 10_000)
  const targets = await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`, Date.now() + 10_000)
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('没有找到可用的页面 target')

  const cdp = connect(page.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url })

  const deadline = Date.now() + 240_000
  let state = { status: null, error: null }
  while (Date.now() < deadline) {
    const probe = await cdp.send('Runtime.evaluate', {
      expression:
        'JSON.stringify({status: window.__mp4Probe?.status ?? null, error: window.__mp4Probe?.error ?? null})',
      returnByValue: true,
    })
    const value = probe.result?.value
    if (value) state = JSON.parse(value)
    if (state.status === 'completed' || state.status === 'failed') break
    await sleep(500)
  }

  const evaluate = async (expression) => {
    const reply = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
    if (reply.exceptionDetails) {
      throw new Error(`页面内取值失败：${reply.exceptionDetails.text}`)
    }
    return reply.result?.value
  }

  const summary = JSON.parse(
    await evaluate('JSON.stringify({environment: window.__mp4Probe.environment, support: window.__mp4Probe.support, failurePaths: window.__mp4Probe.failurePaths ?? null, chosen: window.__mp4Probe.chosen ?? null, file: window.__mp4Probe.file ? {bytes: window.__mp4Probe.file.bytes, frames: window.__mp4Probe.file.frames, firstTimestampUs: window.__mp4Probe.file.firstTimestampUs, lastEndTimestampUs: window.__mp4Probe.file.lastEndTimestampUs, mimeType: window.__mp4Probe.file.mimeType} : null, playback: window.__mp4Probe.playback ? {...window.__mp4Probe.playback, contactFramePng: undefined, resultFramePng: undefined} : null, timings: window.__mp4Probe.timings ?? null, error: window.__mp4Probe.error ?? null, log: window.__mp4Probe.log})'),
  )

  let base64 = null
  if (state.status === 'completed') {
    base64 = await evaluate('window.__mp4Probe.file.base64')
    const contactPng = await evaluate('window.__mp4Probe.playback.contactFramePng')
    const resultPng = await evaluate('window.__mp4Probe.playback.resultFramePng')
    await writeFile(resolve(outDir, 'sample.mp4'), Buffer.from(base64, 'base64'))
    if (contactPng) {
      await writeFile(resolve(outDir, 'contact-3.2s.png'), Buffer.from(contactPng.split(',')[1], 'base64'))
    }
    if (resultPng) {
      await writeFile(resolve(outDir, 'result-4.6s.png'), Buffer.from(resultPng.split(',')[1], 'base64'))
    }
  }

  const report = {
    browser: {
      name: browserName,
      product: version.Browser,
      protocolVersion: version['Protocol-Version'],
      userAgent: version['User-Agent'],
      executable,
      headless: true,
      launchArgs: ['--headless=new', '--enable-unsafe-swiftshader'],
    },
    generatedAt: new Date().toISOString(),
    url,
    node: process.version,
    ...summary,
  }
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))

  if (state.status !== 'completed') {
    console.error(`验证失败：${summary.error ?? '未知原因'}`)
    console.error(summary.log.join('\n'))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({ ...report, log: undefined, support: report.support }, null, 2))
  }

  cdp.close()
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exitCode = 1
} finally {
  await stopChildren()
}

// Writes the entrance's still pictures into public/entrance: the scene alone, at its first
// moment (it holds still there while it fades in), without the words. They stand in while the
// scene loads, and for good when less motion is asked for or WebGL 2 is missing.
//
//   npm run build && node scripts/entrance/still.mjs
//
// It serves dist/client itself and drives Chrome without a window. Set CHROME to the Chrome
// executable when it is not at the macOS default.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const site = join(root, 'dist', 'client')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// One for each common shape of screen, each a little sharper than the screen; the page picks the
// nearest (Entrance.tsx), so the scene fades in over the same picture.
const SHOTS = [
  { file: 'still-wide.webp', width: 1792, height: 1120, scale: 1.25 },
  { file: 'still-wider.webp', width: 1792, height: 1008, scale: 1.25 },
  { file: 'still-widest.webp', width: 1536, height: 730, scale: 1.25 },
  { file: 'still-classic.webp', width: 1280, height: 960, scale: 1.25 },
  { file: 'still-tablet.webp', width: 768, height: 1024, scale: 1.5, mobile: true },
  { file: 'still-phone.webp', width: 390, height: 664, scale: 2, mobile: true },
  { file: 'still-tall.webp', width: 430, height: 932, scale: 2, mobile: true },
  { file: 'still-low.webp', width: 844, height: 390, scale: 2, mobile: true },
]
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
// The words, the wash under them and the old picture are hidden, and the scene shows at once.
const HIDE = `.entrance-copy, .entrance-still, .entrance-stage::after { display: none !important }
.entrance-scene { opacity: 1 !important; transition: none !important }`

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// The production build, with the page served for any path that is not a file, as the Worker does.
const server = createServer((request, response) => {
  let file = join(site, decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
  try {
    if (!statSync(file).isFile()) throw new Error()
  } catch {
    file = join(site, 'index.html')
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  response.end(readFileSync(file))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

const profile = mkdtempSync(join(tmpdir(), 'sakiyomi-still-'))
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-swiftshader', 'about:blank'], {
  stdio: ['ignore', 'ignore', 'pipe'],
})
try {
  // Chrome says on stderr where its DevTools socket is.
  const socketUrl = await new Promise((done, fail) => {
    let said = ''
    browser.stderr.on('data', (chunk) => {
      said += chunk
      const found = said.match(/ws:\/\/\S+/)
      if (found) done(found[0])
    })
    browser.on('exit', () => fail(new Error('Chrome did not start')))
  })
  const port = new URL(socketUrl).port
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) => target.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done) => socket.addEventListener('open', done))
  let id = 0
  const waiting = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    waiting.get(message.id)?.(message.result)
    waiting.delete(message.id)
  })
  const send = (method, params = {}) =>
    new Promise((done) => {
      waiting.set(++id, done)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const value = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value

  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(HIDE)}; document.head.append(style) })`,
  })
  for (const shot of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: shot.scale, mobile: Boolean(shot.mobile) })
    await send('Page.navigate', { url: `${origin}/` })
    const start = Date.now()
    while (!(await value(`document.querySelector('.entrance-scene')?.dataset.ready === 'true'`))) {
      if (Date.now() - start > 30000) throw new Error('the scene did not draw')
      await sleep(50)
    }
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 70 })
    writeFileSync(join(root, 'public', 'entrance', shot.file), Buffer.from(data, 'base64'))
    console.log(`public/entrance/${shot.file}`)
  }
  socket.close()
} finally {
  browser.kill()
  server.close()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}

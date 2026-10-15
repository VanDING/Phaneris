/** Real native Electron browser manager and CDP; isolated profile, loopback pages only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import { BrowserPaneManager } from '../../../apps/electron/src/main/browser-pane-manager'
import { executeBrowserToolCommand } from '../../../packages/shared/src/agent/browser-tool-runtime'
import type { BrowserPaneFns } from '../../../packages/shared/src/agent/browser-tools'

const output = process.argv[2]!
app.setPath('userData', join(output, 'electron-profile'))
app.commandLine.appendSwitch('disable-background-timer-throttling')
const checks: string[] = [], samples: unknown[] = []
let manager: BrowserPaneManager | undefined
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(join(output, 'page.html'))) })
const secret = 'SYNTHETIC_BROWSER_SECRET_015'
;(async () => {
  await app.whenReady()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  manager = new BrowserPaneManager()
  const id = manager.createInstance('native-015', { show: false })
  await manager.navigate(id, `http://127.0.0.1:${(server.address() as { port: number }).port}/`)
  const m = manager
  const evaluate = (expression: string) => m.evaluate(id, expression)
  const wait = async (expression: string) => {
    const until = Date.now() + 10_000
    while (!await evaluate(expression)) { assert(Date.now() < until, `Page did not reach ${expression}`); await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  await wait('!!document.querySelector("#password")')
  const ref = async (name: string) => {
    const snapshot = await m.getAccessibilitySnapshot(id)
    if (name === 'Increment') samples.push({ snapshot })
    const node = snapshot.nodes.find(node => node.name === name)
    assert(node, `Missing actual AX ref: ${name}`)
    return node.ref
  }
  const fns: BrowserPaneFns = {
    async openPanel() { return { instanceId: id } }, navigate: url => m.navigate(id, url), snapshot: () => m.getAccessibilitySnapshot(id),
    click: (ref, options) => m.clickElement(id, ref, options), clickAt: (x, y) => m.clickAtCoordinates(id, x, y), drag: (a,b,c,d) => m.drag(id,a,b,c,d),
    fill: (ref, value) => m.fillElement(id, ref, value), type: text => m.typeText(id, text), select: (ref,value) => m.selectOption(id,ref,value),
    setClipboard: text => m.setClipboard(id,text), getClipboard: () => m.getClipboard(id), screenshot: args => m.screenshot(id,args),
    screenshotRegion: args => m.screenshotRegion(id,args), getConsoleLogs: async args => m.getConsoleLogs(id,args),
    windowResize: async args => m.windowResize(id,args.width,args.height), getNetworkLogs: async args => m.getNetworkLogs(id,args),
    waitFor: args => m.waitFor(id,args), sendKey: args => m.sendKey(id,args), getDownloads: args => m.getDownloads(id,args),
    async upload(ref, paths) { await m.uploadFile(id,ref,paths) }, scroll: (direction, amount) => m.scroll(id,direction,amount),
    goBack: () => m.goBack(id), goForward: () => m.goForward(id), evaluate,
    async focusWindow() { throw Error('Unexpected focus: native input must work while hidden') },
    async releaseControl() { throw Error('Not exercised') }, async closeWindow() { throw Error('Not exercised') }, async hideWindow() { throw Error('Not exercised') },
    async listWindows() { return m.listInstances() }, detectChallenge: () => m.detectSecurityChallenge(id),
  }
  const execute = (command: string | string[]) => executeBrowserToolCommand({ command, fns, sessionId: 'native-015' })
  assert.equal(m.getInstance(id)?.window.isVisible(), false)
  await execute(['fill', await ref('Controlled text'), "user's input"])
  await wait('document.querySelector("#text-state").textContent === "user\'s input"')
  const clicked = await execute(['click', await ref('Increment')])
  samples.push({ clicked, counter: await evaluate('document.querySelector("#click-state").textContent'), form: await evaluate('document.querySelector("main").innerText') })
  await wait('document.querySelector("#click-state").textContent === "1"')
  checks.push('U15-21-hidden-trusted-click-and-react-controlled-fill')
  await execute(['select', await ref('Native choices'), 'second'])
  await wait('document.querySelector("#select-state").textContent === "second"')
  await execute(['click', await ref('Custom choices')])
  await execute(['select', await ref('Custom choices'), 'Blue'])
  await wait('document.querySelector("#custom-state").textContent === "Blue"')
  checks.push('U15-21-native-and-custom-select-update-state')
  const password = await ref('Password')
  const filled = await execute(['fill', password, secret])
  assert(!filled.output.includes(secret)); assert(filled.output.includes('password field'))
  await execute(['type', '-typed'])
  const pasted = await execute(['paste', '-pasted'])
  assert(!pasted.output.includes(secret))
  assert.equal(await evaluate('document.querySelector("#password").value'), `${secret}-typed-pasted`)
  assert(!JSON.stringify(await m.getAccessibilitySnapshot(id)).includes(secret))
  checks.push('U15-24-password-fill-type-paste-no-output-or-snapshot-leak')
  assert.equal(m.getInstance(id)?.window.isVisible(), false)
  checks.push('U15-21-all-input-completes-without-focusing-window')
  await execute(`fill ${await ref('Controlled text')} user's text`)
  assert.equal(await evaluate('document.querySelector("#text").value'), "user's text")
  checks.push('U15-25-apostrophe-command-parser')
  const sparse = await m.detectSecurityChallenge(id)
  assert.equal(sparse.detected, false)
  await evaluate('document.body.insertAdjacentHTML("beforeend", `<div role="menu" data-state="open"><button>Verify you are human</button></div>`)')
  assert.equal((await m.detectSecurityChallenge(id)).detected, false)
  checks.push('U15-23-normal-page-and-open-menu-not-challenges')
  await evaluate('document.querySelector("[role=menu]").remove(); window._cf_chl_opt={}; document.title="Just a moment..."; document.body.insertAdjacentHTML("beforeend", `<form id="challenge-form" action="/cdn-cgi/test"><div id="challenge-stage">Verify you are human by completing the action below</div></form>`)')
  const challenge = await m.detectSecurityChallenge(id)
  assert(challenge.detected); samples.push({ challenge })
  checks.push('U15-23-strong-challenge-confirmed-after-second-look')
  await evaluate('delete window._cf_chl_opt; document.querySelector("#challenge-form").remove(); document.title="Native fixture"; document.body.style.background="rgb(22, 66, 111)"')
  const window = m.getInstance(id)!.window
  const before = { visible: window.isVisible(), opacity: window.getOpacity(), onTop: window.isAlwaysOnTop(), bounds: window.getBounds() }
  const screenshot = await m.screenshot(id, { format: 'png', includeMetadata: true })
  writeFileSync(join(output, 'hidden-current-frame.png'), screenshot.imageBuffer)
  const image = nativeImage.createFromBuffer(screenshot.imageBuffer), size = image.getSize(), bitmap = image.toBitmap()
  const offset = ((size.height - 20) * size.width + size.width - 20) * 4
  assert.deepEqual([...bitmap.subarray(offset, offset + 3)], [111,66,22])
  assert.deepEqual({ visible: window.isVisible(), opacity: window.getOpacity(), onTop: window.isAlwaysOnTop(), bounds: window.getBounds() }, before)
  samples.push({ screenshot: { size, metadata: screenshot.metadata }, before })
  checks.push('U15-22-hidden-screenshot-current-pixels-and-window-restoration')
  // Exercise the recovery restore function with a pre-existing topmost window too.
  window.setAlwaysOnTop(true)
  const undo = (m as unknown as { revealInvisiblyForCapture(window: Electron.BrowserWindow): () => void }).revealInvisiblyForCapture(window)
  undo(); assert(window.isAlwaysOnTop()); assert(!window.isVisible()); assert.equal(window.getOpacity(), before.opacity)
  checks.push('U15-22-recovery-preserves-pre-existing-topmost-state')
})().then(() => {
  writeFileSync(join(output, 'native-browser.json'), JSON.stringify({ checks, samples }, null, 2)); app.exit(0)
}, error => {
  writeFileSync(join(output, 'native-browser.json'), JSON.stringify({ checks, samples, error: String(error), stack: error.stack }, null, 2)); app.exit(1)
}).finally(() => { manager?.destroyAll(); server.close() })

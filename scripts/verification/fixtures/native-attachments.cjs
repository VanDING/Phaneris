const { firstBusinessWindow } = require('./electron-windows.cjs')
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { _electron } = require('playwright')
;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL; delete env.NODE_OPTIONS
  const app = await _electron.launch({ executablePath: fixture.executable, args: fixture.executable ? [] : [join(fixture.root, 'apps/electron')], cwd: fixture.cwd, env, timeout: 60000 })
  const checks = [], errors = [], stores = [], sends = [], wire = []
  const until = async predicate => {
    const deadline = Date.now() + 30000
    while (!await predicate()) { assert(Date.now() < deadline, 'native RPC observation deadline'); await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  let page
  try {
    page = await firstBusinessWindow(app)
    page.on('pageerror', error => errors.push(error.message))
    await page.context().tracing.start({ screenshots: true, snapshots: true })
    await page.getByText('Attachment session', { exact: true }).first().waitFor({ timeout: 60000 })
    await page.getByText('Attachment session', { exact: true }).first().click()
    const input = page.locator('[contenteditable=true]').first()
    await input.waitFor()
    // contextBridge freezes the API. Observe the actual preload WebSocket via
    // CDP instead of replacing RPC methods or introducing a fixture API.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    cdp.on('Network.webSocketFrameSent', event => {
      try {
        const packet = JSON.parse(event.response.payloadData)
        if (packet.channel === 'file:storeAttachment') stores.push({ id: packet.id, input: packet.args[1] })
        if (packet.channel === 'sessions:sendMessage') sends.push(packet.args)
        if (['file:storeAttachment', 'sessions:sendMessage'].includes(packet.channel)) wire.push(packet)
      } catch {}
    })
    cdp.on('Network.webSocketFrameReceived', event => {
      try {
        const packet = JSON.parse(event.response.payloadData)
        const call = stores.find(call => call.id === packet.id)
        if (call) { call.result = packet.result; call.error = packet.error; wire.push(packet) }
      } catch {}
    })
    await page.evaluate(() => window.electronAPI.reconnectTransport())
    await until(() => page.evaluate(async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected'))
    const good = readFileSync(fixture.heic).toString('base64')
    for (const [index, method] of ['choose', 'drop', 'paste'].entries()) {
      if (method === 'choose') await page.locator('input[type=file]').setInputFiles({ name: 'chosen.heic', mimeType: '', buffer: Buffer.from(good, 'base64') })
      else await input.evaluate((element, { method, base64 }) => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
        const files = new DataTransfer()
        files.items.add(new File([bytes], method + '.heic', { type: method === 'drop' ? 'application/octet-stream' : '' }))
        const event = method === 'drop' ? new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true })
          : new ClipboardEvent('paste', { clipboardData: files, bubbles: true, cancelable: true })
        element.dispatchEvent(event)
      }, { method, base64: good })
      await until(() => page.evaluate(async id => (await window.electronAPI.getDraft(id))?.attachments?.length === 1, fixture.session))
      await page.getByRole('img', { name: method === 'choose' ? 'chosen.heic' : `${method}.heic`, exact: true }).waitFor()
      await input.fill(`NATIVE_HEIC_${method}`)
      await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click()
      await until(() => sends.length === index + 1)
      await page.waitForFunction(() => document.querySelector('[contenteditable=true]')?.textContent === '', null, { timeout: 30000 })
      await until(() => page.evaluate(async ({ id, count }) => (await window.electronAPI.getSessionMessages(id))?.messages?.filter(message => message.role === 'assistant' || message.type === 'assistant').length >= count, { id: fixture.session, count: index + 1 }))
      checks.push(`actual ${method} HEIC normalizes metadata and bytes before provider dispatch`)
    }
    await page.locator('input[type=file]').setInputFiles({ name: 'large.heic', mimeType: '', buffer: readFileSync(fixture.photo) })
    await page.getByRole('img', { name: 'large.heic', exact: true }).waitFor()
    await input.fill('NATIVE_PENDING_SNAPSHOT')
    await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click()
    await until(() => stores.some(call => call.input.name === 'large.heic'))
    assert(!stores.find(call => call.input.name === 'large.heic').result, 'the new draft must be typed while storage is still pending')
    await input.fill('NEXT_DRAFT_WHILE_STORING')
    await until(() => sends.length === 4)
    await until(() => page.evaluate(async id => (await window.electronAPI.getDraft(id))?.text === 'NEXT_DRAFT_WHILE_STORING', fixture.session))
    assert.equal(await input.innerText(), 'NEXT_DRAFT_WHILE_STORING')
    checks.push('a late storage acknowledgement preserves text typed after submission')
    await page.locator('input[type=file]').setInputFiles({ name: 'damaged.heic', mimeType: '', buffer: readFileSync(fixture.broken) })
    await until(() => page.evaluate(async id => (await window.electronAPI.getDraft(id))?.attachments?.some(attachment => attachment.name === 'damaged.heic'), fixture.session))
    await input.fill('NATIVE_FAILED_HEIC_DRAFT')
    await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click()
    await until(() => stores.some(call => call.error))
    assert.equal(await input.innerText(), 'NATIVE_FAILED_HEIC_DRAFT')
    assert.equal(sends.length, 4)
    const retryable = await page.evaluate(() => !!document.querySelector('[data-touch-reveal]'))
    assert(retryable, 'failed attachment remains removable/retryable')
    checks.push('failed transcode retains the text and attachment without dispatch')
    const native = await app.evaluate(({ nativeImage }, base64) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
      return { empty: image.isEmpty(), size: image.getSize() }
    }, stores.find(call => call.result).result.resizedBase64)
    assert.equal(native.empty, false); assert.deepEqual(native.size, { width: 800, height: 600 })
    checks.push('actual main-process nativeImage decodes the RPC-normalized JPEG')
    const pty = await app.evaluate(async ({ app }, cwd) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
      const modulePath = load.resolve('node-pty')
      const terminal = load('node-pty').spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo NATIVE_PTY_OK'], { name: 'xterm', cols: 80, rows: 24, cwd, env: process.env })
      return new Promise((resolve, reject) => {
        let output = ''
        const timer = setTimeout(() => { terminal.kill(); reject(new Error('Actual ConPTY exceeded 8s')) }, 8000)
        terminal.onData(data => { output += data })
        terminal.onExit(event => { clearTimeout(timer); resolve({ modulePath, output, exitCode: event.exitCode, appPath: app.getAppPath() }) })
      })
    }, fixture.cwd)
    assert.equal(pty.exitCode, 0); assert(pty.output.includes('NATIVE_PTY_OK'))
    if (fixture.executable) assert(pty.modulePath.startsWith(pty.appPath), 'packaged ConPTY must resolve inside the shipped app')
    writeFileSync(join(fixture.output, 'native-pty.json'), JSON.stringify(pty, null, 2))
    checks.push('actual Electron main loads node-pty and executes a real ConPTY child')
    assert.deepEqual(errors, [])
  } finally {
    if (page) {
      const state = await page.evaluate(() => ({ text: document.querySelector('[contenteditable=true]')?.textContent, body: document.body.innerText.slice(-2500) })).catch(() => ({}))
      writeFileSync(join(fixture.output, 'native-attachments.json'), JSON.stringify({ checks, errors, stores, sends, state, wire }, null, 2))
      await page.screenshot({ path: join(fixture.output, 'native-attachments.png') }).catch(() => {})
      await page.context().tracing.stop({ path: join(fixture.output, 'trace.zip') }).catch(() => {})
    }
    await app.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

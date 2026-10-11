/** Actual Electron main/preload/business renderer in a disposable profile. Runs under Node for native pipes. */
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync, watch } = require('node:fs')
const { join } = require('node:path')
const { _electron } = require('playwright')
const { verifyConversation, changeLanguageAndReturn } = require('./conversation-client.cjs')

async function waitForCondition(page, predicate, argument) {
  const deadline = Date.now() + 30000
  while (!await page.evaluate(predicate, argument)) {
    if (Date.now() >= deadline) throw new Error('Native browser condition did not become true in 30000ms')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0',
    PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const app = await _electron.launch({ args: [join(fixture.root, 'apps/electron')], cwd: fixture.root, env, timeout: 30_000 })
  const checks = [], errors = [], consoleTrace = []
  let mainDiagnostics = '', fatalExitVerified = false
  app.process().stderr.on('data', data => { mainDiagnostics += data.toString() })
  const draftWrites = []
  const draftWatcher = watch(fixture.config, (_event, file) => {
    if (String(file) !== 'drafts.json') return
    try { draftWrites.push({ time: Date.now(), value: JSON.parse(readFileSync(join(fixture.config, 'drafts.json'), 'utf8')) }) } catch {}
  })
  let page
  try {
    page = await app.firstWindow({ timeout: 30_000 })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => consoleTrace.push({ type: message.type(), text: message.text().slice(0, 2000) }))
    await page.waitForFunction(() => document.documentElement.dataset.clientPlatform === 'electron', null, { timeout: 60_000 })
    await page.getByText('Governance session', { exact: true }).first().waitFor({ timeout: 60_000 })
    assert.equal((await page.evaluate(() => window.electronAPI.getTransportConnectionState())).status, 'connected')
    checks.push('native main/preload initializes transport before business renderer')
    assert((await page.evaluate(() => window.electronAPI.getSessions())).some(item => item.id === fixture.session))
    checks.push('native RPC facade reads the same persisted domain fixture')
    await page.getByText('Governance session', { exact: true }).first().click()
    const input = page.locator('[contenteditable="true"]').first()
    await input.waitFor()
    await input.fill('Native session draft')
    await waitForCondition(page, async id => (await window.electronAPI.getDraft(id))?.text === 'Native session draft', fixture.session)
    await page.getByText('Other governance session', { exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === '')
    await input.fill('Other native draft')
    await waitForCondition(page, async id => (await window.electronAPI.getDraft(id))?.text === 'Other native draft', fixture.other)
    await page.getByText('Governance session', { exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === 'Native session draft')
    checks.push('native session switching preserves separate persisted drafts')
    await changeLanguageAndReturn(page, '简体中文', 'Governance session')
    assert.equal(await input.textContent(), 'Native session draft')
    checks.push('native language change retains current input draft')
    writeFileSync(join(fixture.output, 'native-drafts-before-workspace.json'), JSON.stringify(await page.evaluate(() => window.electronAPI.getAllDrafts()), null, 2))
    const keyboardRow = page.getByText('Other governance session', { exact: true }).first().locator('xpath=ancestor::*[@role="option"][1]')
    await keyboardRow.focus()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === 'Other native draft')
    await page.getByText('Governance session', { exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === 'Native session draft')
    checks.push('native keyboard activation preserves draft ownership')
    await input.fill('Native pending draft')
    await page.getByText('Governance workspace', { exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Second workspace' }).click()
    await page.getByText('Second workspace session', { exact: true }).first().waitFor()
    assert.equal(await page.evaluate(() => window.electronAPI.getWindowWorkspace()), 'second')
    checks.push('native workspace switch updates the host binding')
    assert.equal((await page.evaluate(id => window.electronAPI.getDraft(id), fixture.session)).text, 'Native pending draft')
    checks.push('native rapid workspace switch flushes pending composer and persistence timers')
    await page.evaluate(() => window.electronAPI.reconnectTransport())
    await waitForCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    assert.equal(await page.evaluate(() => window.electronAPI.getWindowWorkspace()), 'second')
    assert.equal((await page.evaluate(() => window.electronAPI.getSessions())).length, 1)
    checks.push('native reconnect retains the second workspace binding')
    writeFileSync(join(fixture.output, 'native-drafts-in-second-workspace.json'), JSON.stringify(await page.evaluate(() => window.electronAPI.getAllDrafts()), null, 2))
    await page.getByText('Second workspace', { exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Governance workspace' }).click()
    await page.getByText('Governance session', { exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === 'Native pending draft')
    checks.push('native returning workspace restores its draft')
    await page.evaluate(() => window.electronAPI.reconnectTransport())
    await waitForCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    checks.push('native reconnect preserves accepted workspace and session facts')
    checks.push(...await verifyConversation(page, fixture.conversation, fixture.output, 'electron'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const layouts = []
    const originalMinimum = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize())
    // The desktop window normally enforces a minimum width. Override only the
    // disposable fixture window so the 420px diagnostic measures that width.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
    for (const width of [1280, 420]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 900), width)
      await waitForCondition(page, expected => window.innerWidth === expected, width)
      layouts.push(await page.evaluate(() => ({ viewportWidth: innerWidth, viewportHeight: innerHeight, contentWidth: document.documentElement.scrollWidth, devicePixelRatio })))
      await page.screenshot({ path: join(fixture.output, `electron-${width}.png`), fullPage: false })
      checks.push(`native ${width}px reduced-motion layout`)
    }
    writeFileSync(join(fixture.output, 'native-layouts.json'), JSON.stringify({ originalMinimum, fixtureMinimumOverride: true, layouts }, null, 2))
    assert.deepEqual(errors, [])
    assert.deepEqual(consoleTrace.filter(message => message.type === 'error'), [])
    await page.screenshot({ path: join(fixture.output, 'native-final.png'), fullPage: true })
    const started = Date.now()
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native fatal shutdown exceeded 13000ms')), 13000)
      app.process().once('close', code => { clearTimeout(timer); resolve(code) })
    })
    await app.evaluate(() => {
      setTimeout(() => { void Promise.reject(new Error('governance-native-fatal', { cause: new Error('governance-native-first-cause') })) }, 50)
    })
    const exitCode = await closed
    assert.equal(exitCode, 1)
    assert(mainDiagnostics.includes('governance-native-fatal') && mainDiagnostics.includes('governance-native-first-cause'), 'Native first failure and cause must survive shutdown')
    fatalExitVerified = true
    writeFileSync(join(fixture.output, 'native-fatal.json'), JSON.stringify({ exitCode, elapsedMs: Date.now() - started, diagnostics: mainDiagnostics }, null, 2))
    checks.push('native main fatal rejection preserves its cause and exits nonzero within the original deadline')
  } finally {
    if (page) await page.screenshot({ path: join(fixture.output, 'native-final.png'), fullPage: true }).catch(() => {})
    draftWatcher.close(); writeFileSync(join(fixture.output, 'native-draft-writes.json'), JSON.stringify(draftWrites, null, 2))
    if (page) writeFileSync(join(fixture.output, 'native-state.json'), JSON.stringify(await page.evaluate(async () => ({ url: location.href, inputs: [...document.querySelectorAll('[contenteditable=\"true\"]')].map(element => element.textContent), drafts: await window.electronAPI.getAllDrafts() })).catch(error => ({ error: error.message })), null, 2) + '\n')
    writeFileSync(join(fixture.output, 'native-client.json'), JSON.stringify({ checks, errors, consoleTrace }, null, 2) + '\n')
    writeFileSync(join(fixture.output, 'native-main.log'), mainDiagnostics)
    if (!fatalExitVerified) await app.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

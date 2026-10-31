const { firstBusinessWindow } = require('./electron-windows.cjs')
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
  const app = await _electron.launch({
    ...(fixture.executablePath ? { executablePath: fixture.executablePath, args: [] } : { args: [join(fixture.root, 'apps/electron')] }),
    cwd: fixture.root, env, timeout: 30_000,
  })
  const checks = [], errors = [], consoleTrace = []
  let mainDiagnostics = '', fatalExitVerified = false
  app.process().stderr.on('data', data => { mainDiagnostics += data.toString() })
  const draftWrites = []
  const draftDirectory = join(fixture.recovery.workspace, 'sessions', fixture.session)
  const draftWatcher = watch(draftDirectory, (_event, file) => {
    if (String(file) !== 'draft.json') return
    try { draftWrites.push({ time: Date.now(), value: JSON.parse(readFileSync(join(draftDirectory, 'draft.json'), 'utf8')) }) } catch {}
  })
  let page
  let tracing = false
  try {
    page = await firstBusinessWindow(app, { timeout: 60000 })
    assert(!app.windows().some(candidate => /\/startup\.html(?:[?#]|$)/.test(candidate.url())), 'Startup feedback must close before workspace interaction')
    checks.push('startup feedback hands off to the workspace without a residual window')
    await page.context().tracing.start({ screenshots: true, snapshots: true }); tracing = true
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => consoleTrace.push({ type: message.type(), text: message.text().slice(0, 2000) }))
    await page.waitForFunction(() => document.documentElement.dataset.clientPlatform === 'electron', null, { timeout: 60_000 })
    await page.getByText('Governance session', { exact: true }).first().waitFor({ timeout: 60_000 })
    assert.equal((await page.evaluate(() => window.electronAPI.getTransportConnectionState())).status, 'connected')
    checks.push('native main/preload initializes transport before business renderer')
    assert((await page.evaluate(() => window.electronAPI.getSessions())).some(item => item.id === fixture.session))
    checks.push('native RPC facade reads the same persisted domain fixture')
    const connectionProbe = await page.evaluate(params => window.electronAPI.testLlmConnectionSetup(params), fixture.connectionProbe)
    writeFileSync(join(fixture.output, 'native-connection-probe.json'), JSON.stringify(connectionProbe, null, 2))
    assert.equal(connectionProbe.success, true, JSON.stringify(connectionProbe))
    checks.push('native main/preload/RPC validates a provider through the real Pi subprocess')
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
    await assert.rejects(() => page.evaluate(id => window.electronAPI.getDraft(id), fixture.session), /not found in workspace/)
    assert.equal(JSON.parse(readFileSync(join(draftDirectory, 'draft.json'), 'utf8')).text, 'Native pending draft')
    checks.push('native rapid workspace switch flushes the session-owned draft and rejects cross-workspace reads')
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
    assert.equal((await page.evaluate(id => window.electronAPI.getDraft(id), fixture.session)).text, 'Native pending draft')
    checks.push('native returning workspace restores its draft')
    await page.evaluate(() => window.electronAPI.reconnectTransport())
    await waitForCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    checks.push('native reconnect preserves accepted workspace and session facts')
    await changeLanguageAndReturn(page, 'English', 'Governance session')
    const recovery = await page.evaluate(({ session, operation }) => window.electronAPI.getRecoveryEvidence(session, operation), { session: fixture.session, operation: fixture.recovery.toolOperationId })
    assert.equal(recovery.verdict.kind, 'reconcile_required')
    assert(!require('node:fs').existsSync(join(fixture.recovery.workspace, 'must-not-replay.txt')))
    // Use the production renderer navigation contract. Bound Workbench routes
    // are internal surfaces, not OS-level phaneris:// entry points.
    const openRoute = route => page.evaluate(route => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route } })), route)
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    // The consolidated Run view replaced the former reliability details/export UI.
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await page.locator('[data-run-diagnostics]').waitFor()
    await page.waitForFunction(() => document.querySelector('[data-run-diagnostics]')?.textContent.includes('/ 1'))
    const reliability = (await page.evaluate(id => window.electronAPI.getSessionDecisions(id), fixture.session)).reliability
    assert.equal(reliability.state, 'available')
    assert.equal(reliability.unsettled.count, 1)
    assert.equal(reliability.unsettled.toolCount, 1)
    assert.equal(reliability.unsettled.modelCount, 0)
    assert.deepEqual(reliability.unsettled.operationIds, [fixture.recovery.toolOperationId]); assert.equal(reliability.userAcceptance, 'unknown')
    writeFileSync(join(fixture.output, 'native-reliability-report.json'), JSON.stringify(reliability, null, 2))
    await page.screenshot({ path: join(fixture.output, 'native-recovery-run.png') })
    checks.push('restored production desktop retains unknown tool facts in RPC and Run diagnostics')
    await openRoute(`artifact/${fixture.recovery.artifactId}`)
    const workbench = page.getByTestId('artifact-workbench')
    await workbench.waitFor(); await page.getByTestId('artifact-edit').click()
    const artifactInput = workbench.locator('textarea'); await artifactInput.fill('NATIVE_RESTORED_ARTIFACT_ACCEPTED')
    const retainedHistory = await page.evaluate(id => window.electronAPI.getSessionMessages(id), fixture.session)
    assert(retainedHistory.messages.length >= 160, 'The theme acceptance must retain the long-session fixture')
    for (const mode of ['dark', 'light']) {
      await page.evaluate(mode => window.electronAPI.setThemePreferences({ mode }), mode)
      await page.waitForFunction(mode => document.documentElement.classList.contains('dark') === (mode === 'dark'), mode)
      assert.equal(await artifactInput.inputValue(), 'NATIVE_RESTORED_ARTIFACT_ACCEPTED')
    }
    checks.push('long-session theme switching preserves the restored Artifact editor')
    await page.getByTestId('artifact-save').click(); await page.getByTestId('artifact-submit').click(); await page.getByTestId('artifact-accept').click()
    await waitForCondition(page, async id => (await window.electronAPI.getArtifact('fixture', id)).artifact.status === 'accepted', fixture.recovery.artifactId)
    assert.equal(readFileSync(join(fixture.recovery.workspace, 'restored-report.txt'), 'utf8'), 'NATIVE_RESTORED_ARTIFACT_ACCEPTED')
    await page.screenshot({ path: join(fixture.output, 'native-restored-artifact.png') })
    checks.push('restored Artifact checkout saves submits and accepts through production UI')
    await openRoute('plugins/plugin/native-readiness')
    await page.getByText('Executable missing', { exact: false }).first().waitFor()
    await page.getByText('Connection not verified', { exact: false }).first().waitFor()
    await page.getByText('native-guide', { exact: true }).waitFor()
    await page.screenshot({ path: join(fixture.output, 'native-plugin-readiness.png') })
    checks.push('production plugin details distinguish materialized skills and unready sources')
    const confirmation = await page.evaluate(root => window.electronAPI.analyzePluginInstall('fixture', root), join(fixture.output, 'incoming', 'native-readiness'))
    assert.equal(typeof confirmation.planId, 'string')
    await page.evaluate(planId => window.electronAPI.installPlugin('fixture', planId), confirmation.planId)
    checks.push('production RPC installs the workspace-bound confirmation snapshot')
    checks.push(...await verifyConversation(page, fixture.conversation, fixture.output, 'electron'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const layouts = []
    const nativeWindow = await app.browserWindow(page)
    const originalMinimum = await nativeWindow.evaluate(window => window.getMinimumSize())
    // The desktop window normally enforces a minimum width. Override only the
    // disposable fixture window so the 420px diagnostic measures that width.
    await nativeWindow.evaluate(window => window.setMinimumSize(1, 1))
    for (const width of [1280, 420]) {
      await nativeWindow.evaluate((window, size) => window.setContentSize(size, 900), width)
      writeFileSync(join(fixture.output, `native-layout-request-${width}.json`), JSON.stringify({ requestedWidth: width,
        native: await nativeWindow.evaluate(window => ({ minimum: window.getMinimumSize(), bounds: window.getBounds(), content: window.getContentSize() })),
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })) }, null, 2))
      await waitForCondition(page, expected => window.innerWidth === expected, width)
      layouts.push(await page.evaluate(() => ({ viewportWidth: innerWidth, viewportHeight: innerHeight, contentWidth: document.documentElement.scrollWidth, devicePixelRatio })))
      await page.screenshot({ path: join(fixture.output, `electron-${width}.png`), fullPage: false })
      checks.push(`native ${width}px reduced-motion layout`)
    }
    writeFileSync(join(fixture.output, 'native-layouts.json'), JSON.stringify({ originalMinimum, fixtureMinimumOverride: true, layouts }, null, 2))
    assert.deepEqual(errors, [])
    assert.deepEqual(consoleTrace.filter(message => message.type === 'error'), [])
    await page.screenshot({ path: join(fixture.output, 'native-final.png'), fullPage: true })
    await page.context().tracing.stop({ path: join(fixture.output, 'native-trace.zip') }); tracing = false
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
    if (!fixture.executablePath) assert(mainDiagnostics.includes('governance-native-fatal') && mainDiagnostics.includes('governance-native-first-cause'), 'Native first failure and cause must survive shutdown')
    fatalExitVerified = true
    writeFileSync(join(fixture.output, 'native-fatal.json'), JSON.stringify({ exitCode, elapsedMs: Date.now() - started, diagnostics: mainDiagnostics }, null, 2))
    checks.push('native main fatal rejection exits nonzero within the original deadline')
    if (fixture.executablePath) {
      // Packaged defaults deliberately disable file/console logs. Verify the
      // original cause-retention contract in the supported --debug mode too.
      const diagnosticApp = await _electron.launch({ executablePath: fixture.executablePath,
        args: ['--', '--debug'], cwd: fixture.root, env, timeout: 30000 })
      let diagnostics = '', exited = false
      diagnosticApp.process().stderr.on('data', data => { diagnostics += data.toString() })
      try {
        await firstBusinessWindow(diagnosticApp, { timeout: 60000 })
        const fatalStarted = Date.now()
        const diagnosticExit = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Diagnostic fatal shutdown exceeded 13000ms')), 13000)
          diagnosticApp.process().once('close', code => { clearTimeout(timer); resolve(code) })
        })
        await diagnosticApp.evaluate(() => {
          setTimeout(() => { void Promise.reject(new Error('governance-native-fatal', { cause: new Error('governance-native-first-cause') })) }, 50)
        })
        const diagnosticCode = await diagnosticExit; exited = true
        assert.equal(diagnosticCode, 1)
        assert(diagnostics.includes('governance-native-fatal') && diagnostics.includes('governance-native-first-cause'), 'Diagnostic first failure and cause must survive shutdown')
        writeFileSync(join(fixture.output, 'native-fatal-diagnostic.json'), JSON.stringify({ exitCode: diagnosticCode,
          elapsedMs: Date.now() - fatalStarted, diagnostics }, null, 2))
        checks.push('packaged diagnostic mode preserves the first fatal cause and bounded nonzero shutdown')
      } finally { if (!exited) await diagnosticApp.close() }
    }
  } finally {
    if (page && tracing) await page.context().tracing.stop({ path: join(fixture.output, 'native-trace.zip') }).catch(() => {})
    if (page) await page.screenshot({ path: join(fixture.output, 'native-final.png'), fullPage: true }).catch(() => {})
    draftWatcher.close(); writeFileSync(join(fixture.output, 'native-draft-writes.json'), JSON.stringify(draftWrites, null, 2))
    if (page) writeFileSync(join(fixture.output, 'native-state.json'), JSON.stringify(await page.evaluate(async () => ({ url: location.href, inputs: [...document.querySelectorAll('[contenteditable=\"true\"]')].map(element => element.textContent), drafts: await window.electronAPI.getAllDrafts() })).catch(error => ({ error: error.message })), null, 2) + '\n')
    writeFileSync(join(fixture.output, 'native-client.json'), JSON.stringify({ checks, errors, consoleTrace }, null, 2) + '\n')
    writeFileSync(join(fixture.output, 'native-main.log'), mainDiagnostics)
    if (!fatalExitVerified) await app.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

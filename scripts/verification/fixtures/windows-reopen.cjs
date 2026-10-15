/** Native Electron lifecycle and second process; only disposable profiles are used. */
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { _electron, chromium } = require('playwright')

const fixture = JSON.parse(process.argv[2])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = [], observations = []
const profiles = []
async function until(action, label, timeout = 30_000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try { const value = await action(); if (value) return value } catch (error) { last = error }
    await sleep(100)
  }
  throw new Error(`${label}: ${last?.message ?? 'condition did not become true'}`)
}
function seed(name) {
  const config = join(fixture.output, name), workspace = join(config, 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ setupDeferred: true, workspaces: [{ id: 'reopen', name: 'Reopen verification', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'reopen', activeSessionId: null, llmConnections: [], themeMode: 'light', colorTheme: 'default' }))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL; delete env.NODE_OPTIONS
  const args = [...(fixture.executable ? [] : [join(fixture.root, 'apps/electron')]), `--user-data-dir=${join(config, 'user-data')}`]
  profiles.push(config)
  return { config, env, args }
}
async function open(profile) {
  const app = await _electron.launch({ executablePath: fixture.executable, args: profile.args, cwd: fixture.root, env: profile.env, timeout: 60_000 })
  const page = await app.firstWindow({ timeout: 60_000 })
  await page.locator('.sidebar-navigation').waitFor({ timeout: 60_000 })
  return { app, page }
}
async function second(app, profile) {
  // Playwright uses cmd.exe as its Windows pipe wrapper; launch the actual
  // Electron executable here so a second native app reaches the instance lock.
  const child = spawn(fixture.executable ?? require('electron'), profile.args, { cwd: fixture.root, env: profile.env, stdio: 'pipe', windowsHide: true })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const result = await until(() => child.exitCode !== null && { code: child.exitCode }, 'Second instance did not hand off', 15_000)
  writeFileSync(join(profile.config, 'second-instance.log'), output)
  return result
}
function cleanupProfile(profile) {
  // Match the unique --user-data-dir argument, never an installed Phaneris process.
  const userData = join(profile, 'user-data')
  assert(!userData.includes("'"))
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('electron.exe','Phaneris.exe') -and $_.CommandLine -like '*${userData}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20_000 })
}

;(async () => {
  let active
  try {
    const delayed = seed('closing-handoff')
    active = await open(delayed)
    const closingProcess = active.app.process()
    writeFileSync(join(fixture.output, 'native-launch.json'), JSON.stringify({ spawnfile: closingProcess.spawnfile, spawnargs: closingProcess.spawnargs }, null, 2))
    await active.page.screenshot({ path: join(fixture.output, 'before-close.png') })
    const portFile = join(delayed.config, 'user-data/DevToolsActivePort')
    const originalPort = readFileSync(portFile, 'utf8').split(/\r?\n/)[0]
    // Hold the real native exit after cleanup, preserving the same no-window,
    // still-lock-owning state that a slow durable-runtime drain exposes.
    await active.app.evaluate(({ app }, relaunchArgs) => {
      globalThis.__reopenProbeRequests = 0
      app.on('second-instance', () => { globalThis.__reopenProbeRequests++ })
      // The Playwright loader waits for its controller before loading the app.
      // Native relaunch must omit that testing shim and retain a CDP endpoint.
      const relaunch = app.relaunch.bind(app)
      app.relaunch = options => relaunch({ ...options, args: options?.args ?? relaunchArgs })
      const exit = app.exit.bind(app)
      app.exit = code => { setTimeout(() => exit(code), 6000) }
    }, [...delayed.args, '--remote-debugging-port=0'])
    await active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
    assert.equal(await active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0)
    assert.equal((await second(active.app, delayed)).code, 0)
    assert.equal(await active.app.evaluate(() => globalThis.__reopenProbeRequests), 1, 'The second launch must reach the closing native owner')
    assert.equal(closingProcess.exitCode, null, 'Probe must reach the old process while it still owns the instance lock')
    await until(() => closingProcess.exitCode !== null, 'Old process did not exit', 12_000)
    let reopened
    try {
      reopened = await until(async () => {
        const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0]
        if (port === originalPort) return null
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 })
        const page = browser.contexts()[0]?.pages().find(page => page.url().includes('index.html'))
        if (!page) { await browser.close(); return null }
        await page.locator('.sidebar-navigation').waitFor({ timeout: 15_000 })
        return { browser, page }
      }, 'Reopen request was lost while the old process was exiting', 25_000)
      await reopened.page.screenshot({ path: join(fixture.output, 'reopened-after-handoff.png') })
      checks.push('native-close-and-immediate-reopen-preserves-the-launch-request')
      observations.push({ case: 'closing-handoff', oldPid: closingProcess.pid, relaunchedWindowVisible: true })
    } finally { if (reopened) await reopened.browser.close(); cleanupProfile(delayed.config) }
    active = undefined

    const orphan = seed('window-recovery')
    active = await open(orphan)
    const originalPid = active.app.process().pid
    await active.app.evaluate(({ app, BrowserWindow }) => {
      app.removeAllListeners('window-all-closed')
      BrowserWindow.getAllWindows().forEach(window => window.destroy())
    })
    const recoveredPage = active.app.waitForEvent('window')
    assert.equal((await second(active.app, orphan)).code, 0)
    const recovered = await recoveredPage
    await recovered.locator('.sidebar-navigation').waitFor({ timeout: 20_000 })
    assert.equal(active.app.process().pid, originalPid)
    checks.push('second-instance-recovers-a-running-owner-with-no-window')
    await active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.minimize()))
    assert.equal((await second(active.app, orphan)).code, 0)
    await until(() => active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible() && !window.isMinimized())), 'Existing minimized window was not restored')
    assert.equal(await active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    checks.push('duplicate-launch-restores-one-existing-window-without-restarting')
    await active.app.close(); active = undefined

    const repeated = seed('ordinary-reopen')
    for (let cycle = 0; cycle < 3; cycle++) {
      active = await open(repeated)
      const closing = active.app.process()
      const started = Date.now()
      await active.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.close()))
      await until(() => closing.exitCode !== null, 'Ordinary close did not finish', 12_000)
      assert.equal(closing.exitCode, 0)
      assert(!existsSync(join(repeated.config, '.server.lock')), 'Normal exit left the server lock behind')
      observations.push({ case: 'ordinary-reopen', cycle, shutdownMs: Date.now() - started })
      active = undefined
    }
    checks.push('three-native-close-reopen-cycles-exit-and-release-the-server-lock')

    const chartProfile = seed('gantt-corners')
    active = await open(chartProfile)
    const page = active.page
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route: 'gantt' }, bubbles: true })))
    const chart = page.locator('.phaneris-gantt')
    await chart.waitFor({ timeout: 30_000 })
    const cornerMeasurements = []
    const verifyCorners = async label => {
      const result = await chart.evaluate(host => {
        const rect = host.getBoundingClientRect(), style = getComputedStyle(host)
        const points = [[rect.left + 1, rect.top + 1], [rect.right - 1, rect.top + 1], [rect.left + 1, rect.bottom - 1], [rect.right - 1, rect.bottom - 1]]
        return { radius: style.borderTopLeftRadius, overflow: style.overflow,
          cornersClear: points.map(([x, y]) => !host.contains(document.elementFromPoint(x, y))) }
      })
      cornerMeasurements.push({ label, ...result })
      assert(parseFloat(result.radius) > 0)
      assert(result.cornersClear.every(Boolean), `${label}: a square child covers a rounded Gantt corner`)
    }
    await verifyCorners('empty-plan')
    await page.evaluate(async () => {
      const parent = await window.electronAPI.createWorkItem('reopen', { title: 'Corner verification', startAt: '2026-10-10', dueAt: '2026-11-10' })
      for (let index = 0; index < 45; index++) await window.electronAPI.createWorkItem('reopen', {
        title: `Scheduled row ${index + 1}`, parentId: parent.id, startAt: '2026-10-12', dueAt: '2026-11-06',
      })
    })
    await page.locator('.wx-bar').first().waitFor()
    const datesBeforeResize = await page.evaluate(async () => (await window.electronAPI.listWorkItems('reopen')).map(item => ({ id: item.id, startAt: item.startAt, dueAt: item.dueAt })))
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => window.electronAPI.setThemePreferences({ mode, colorTheme: 'default' }), mode)
      await page.waitForFunction(mode => document.documentElement.classList.contains('dark') === (mode === 'dark'), mode)
      for (const width of [1400, 880]) {
        // Exercise the desktop resize path, including native resize observers.
        // CDP viewport emulation is not a Windows BrowserWindow resize.
        await active.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
        await page.waitForTimeout(250)
        await verifyCorners(`${mode}-${width}`)
        await page.screenshot({ path: join(fixture.output, `gantt-${mode}-${width}.png`) })
      }
    }
    const scrolled = await chart.evaluate(host => {
      const scrollable = [...host.querySelectorAll('*')].find(node => node.scrollHeight > node.clientHeight + 50 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
      if (!scrollable) return false
      scrollable.scrollTop = 160
      return scrollable.scrollTop > 0
    })
    assert(scrolled, 'Rounded clipping must preserve the chart scroll container')
    await verifyCorners('scrolled-plan')
    await page.locator('.pg-task-header').hover()
    await page.locator('.pg-task-header-menu').click()
    const chartMenu = page.getByRole('menu')
    await chartMenu.waitFor()
    assert.equal(await chartMenu.evaluate(menu => Boolean(menu.closest('.phaneris-gantt'))), false, 'Task menu remains in its portal outside the clipped chart')
    await page.keyboard.press('Escape')
    const datesAfterResize = await page.evaluate(async () => (await window.electronAPI.listWorkItems('reopen')).map(item => ({ id: item.id, startAt: item.startAt, dueAt: item.dueAt })))
    assert.deepEqual(datesAfterResize, datesBeforeResize, 'Window resizing and clipped menus must not reschedule tasks')
    observations.push({ case: 'gantt-corners', measurements: cornerMeasurements })
    checks.push('native-gantt-rounded-corners-scroll-and-menu-in-light-dark-wide-narrow-views')
    await active.app.close(); active = undefined
  } finally {
    if (active) await Promise.race([active.app.close().catch(() => {}), sleep(2500)])
    profiles.forEach(cleanupProfile)
    writeFileSync(join(fixture.output, 'windows-reopen.json'), JSON.stringify({ checks, observations }, null, 2))
  }
  console.log(JSON.stringify({ passed: checks.length, output: fixture.output }))
})().then(() => process.exit(0), error => {
  writeFileSync(join(fixture.output, 'native-failure.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2))
  console.error(error)
  process.exit(1)
})

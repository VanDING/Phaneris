const { _electron } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const checks = [], samples = [], errors = []
  for (const scene of ['slow', 'fast', 'reduced', 'no-webgl', 'context-lost', 'multiple', 'multiple-late', 'minimized', 'cancel', 'crash']) {
    const profile = join(fixture.output, scene); mkdirSync(profile)
    const env = { ...process.env, PHANERIS_CONFIG_DIR: profile }
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
    const application = await _electron.launch({ args: [fixture.entry, ...(scene === 'no-webgl' ? ['--no-webgl'] : [])], env, timeout: 30000 })
    const nativeProcess = application.process()
    let tracing = false
    try {
      const page = await application.firstWindow()
      page.on('pageerror', error => errors.push({ scene, message: error.message }))
      if (scene === 'slow') { await page.context().tracing.start({ screenshots: true, snapshots: true }); tracing = true }
      if (scene === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.locator('[data-startup-phase="loading"]').waitFor()
      const native = await application.browserWindow(page)
      await page.waitForFunction(() => document.querySelector('canvas'))
      assert(await native.evaluate(window => window.isVisible() || new Promise(resolve => window.once('show', () => resolve(true)))))
      await page.evaluate(() => { window.startupCanvas = document.querySelector('canvas') })
      const isolated = await page.evaluate(() => ({ node: typeof window.require, api: typeof window.electronAPI,
        paper: getComputedStyle(document.querySelector('.startup-surface')).backgroundColor,
        logo: !!document.querySelector('[data-testid="startup-logo"]'), overflow: document.body.scrollWidth > innerWidth }))
      assert.deepEqual(isolated, { node: 'undefined', api: 'undefined', paper: 'rgb(255, 255, 255)', logo: false, overflow: false })
      if (scene === 'cancel') {
        const closed = new Promise(resolve => nativeProcess.once('exit', resolve))
        await native.evaluate(window => window.close())
        await closed
        checks.push('closing the startup surface cancels the process'); continue
      }
      await application.evaluate(async () => globalThis.startupTest.create(1))
      if (scene.startsWith('multiple')) await application.evaluate(async () => globalThis.startupTest.create(1))
      assert(await native.evaluate(window => window.isVisible()))
      assert(await application.evaluate(() => globalThis.startupTest.targets.every(window => !window.isVisible())))
      assert(await application.evaluate(() => {
        const { presentation, targets } = globalThis.startupTest
        return presentation.focusPending(targets[0]) && !targets[0].isVisible()
      }))
      assert.equal(await application.evaluate(() => globalThis.startupTest.presentation.ready(-100)), false)
      if (scene === 'slow') {
        await page.waitForTimeout(700)
        assert.equal(await page.locator('[data-testid="startup-logo"]').count(), 0)
        await page.screenshot({ path: join(fixture.output, 'white-loading.png') })
        const first = await page.screenshot()
        await page.waitForTimeout(180)
        assert.notDeepEqual(await page.screenshot(), first, 'The loading background must animate')
        checks.push('slow backend and hidden renderer retain animated white characters without logo or text')
      }
      if (scene === 'no-webgl') {
        assert.equal(await page.evaluate(() => document.querySelector('canvas').getContext('webgl2')), null)
        await page.locator('.startup-fallback').waitFor()
        await page.screenshot({ path: join(fixture.output, 'webgl-fallback.png') })
      }
      if (scene === 'context-lost') {
        await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext())
        await page.locator('.startup-fallback').waitFor()
        await page.locator('canvas').waitFor({ state: 'detached' })
        await page.evaluate(() => { window.startupCanvas = null })
      }
      if (scene === 'reduced') {
        await page.waitForTimeout(200)
        const still = await page.screenshot()
        await page.waitForTimeout(180)
        assert.deepEqual(await page.screenshot(), still, 'Reduced motion must retain a static character frame')
      }
      if (scene === 'multiple') {
        assert.equal(await application.evaluate(() => {
          const { presentation, targets } = globalThis.startupTest
          return presentation.ready(targets[1].webContents.id)
        }), true)
        assert.equal(await page.locator('[data-testid="startup-logo"]').count(), 0)
      }
      if (scene === 'crash') {
        await application.evaluate(() => globalThis.startupTest.presentation.window.webContents.forcefullyCrashRenderer())
      } else {
        if (scene === 'minimized') await native.evaluate(window => window.minimize())
        const start = Date.now()
        assert.equal(await application.evaluate(() => {
          const { presentation, targets } = globalThis.startupTest
          return presentation.ready(targets[0].webContents.id)
        }), true)
        if (scene === 'minimized') {
          await page.waitForTimeout(200)
          assert.equal(await page.locator('[data-testid="startup-logo"]').count(), 0)
          assert(await native.evaluate(window => window.isMinimized()))
          await native.evaluate(window => window.restore())
        }
        if (scene !== 'reduced') {
          await page.locator('[data-startup-phase="revealing"]').waitFor()
          assert(await page.evaluate(() => window.startupCanvas === document.querySelector('canvas')))
          assert(await application.evaluate(() => globalThis.startupTest.targets.every(window => !window.isVisible())))
          if (scene === 'slow') {
            await page.evaluate(() => {
              for (const animation of document.querySelector('[data-testid="startup-logo"]').getAnimations({ subtree: true })) {
                animation.pause(); animation.currentTime = 120
              }
            })
            await page.screenshot({ path: join(fixture.output, 'white-logo-trace.png') })
            await page.evaluate(() => {
              for (const animation of document.querySelector('[data-testid="startup-logo"]').getAnimations({ subtree: true })) animation.currentTime = 1450
            })
            await page.screenshot({ path: join(fixture.output, 'white-logo-fill.png') })
            await page.evaluate(() => {
              for (const animation of document.querySelector('[data-testid="startup-logo"]').getAnimations({ subtree: true })) {
                animation.currentTime = 0; animation.play()
              }
            })
          }
        }
        await page.waitForEvent('close', { timeout: 10000 })
        const elapsed = Date.now() - start
        console.log(JSON.stringify({ scene, elapsed }))
        if (scene === 'reduced') assert(elapsed < 1500, 'Reduced motion must not wait for the logo animation')
        else if (scene !== 'slow') assert(elapsed >= 1600, `${scene}: Handoff must wait for the real logo entrance (${elapsed}ms)`)
        samples.push({ scene, elapsed, logoClockControlled: scene === 'slow', webglCapabilityEmulated: scene === 'no-webgl', isolated })
      }
      const deadline = Date.now() + 10000
      while (!await application.evaluate(() => globalThis.startupTest.presentation.window.isDestroyed())) {
        assert(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 30))
      }
      if (scene === 'multiple-late') {
        assert.equal(await application.evaluate(() => globalThis.startupTest.targets[1].isVisible()), false)
        assert.equal(await application.evaluate(() => {
          const { presentation, targets } = globalThis.startupTest
          return presentation.ready(targets[1].webContents.id)
        }), true)
      }
      assert(await application.evaluate(() => globalThis.startupTest.targets.every(window => window.isVisible())))
      assert.equal(await application.evaluate(() => globalThis.startupTest.presentation.ready(-100)), false)
      checks.push(`${scene}: readiness ownership, continuous canvas and native handoff without residual window`)
      if (tracing) { await page.context().tracing.stop({ path: join(fixture.output, 'startup-trace.zip') }); tracing = false }
    } finally {
      if (tracing) await application.context().tracing.stop({ path: join(fixture.output, 'failure-trace.zip') })
      if (nativeProcess.exitCode === null) await application.close()
    }
  }
  // Exercise the real main/preload/App readiness path with disposable profiles.
  for (const mode of ['dark-workspace', 'light-onboarding']) {
    const profile = join(fixture.output, mode), workspace = join(profile, 'workspace')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(profile, 'config.json'), JSON.stringify({
      workspaces: [{ id: 'startup-fixture', name: 'Startup workspace', rootPath: workspace, createdAt: 1 }],
      activeWorkspaceId: 'startup-fixture', activeSessionId: null, setupDeferred: mode === 'dark-workspace', llmConnections: [],
      themeMode: mode === 'dark-workspace' ? 'dark' : 'light', colorTheme: 'default', themeFont: 'inter',
    }))
    const env = { ...process.env, PHANERIS_CONFIG_DIR: profile, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '1',
      PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL; delete env.PHANERIS_SERVER_URL
    const application = await _electron.launch({ args: [join(fixture.root, 'apps/electron')], cwd: fixture.root, env, timeout: 60000 })
    let diagnostics = ''
    application.process().stderr.on('data', data => { diagnostics += data.toString() })
    try {
      const startup = await application.firstWindow()
      assert(/\/startup\.html/.test(startup.url()))
      await startup.locator('[data-startup-phase="loading"]').waitFor()
      assert.equal(await startup.locator('[data-testid="startup-logo"]').count(), 0)
      assert.equal(await startup.evaluate(() => getComputedStyle(document.querySelector('.startup-surface')).backgroundColor), 'rgb(255, 255, 255)')
      await startup.evaluate(() => { window.startupCanvas = document.querySelector('canvas') })
      await startup.locator('[data-startup-phase="revealing"]').waitFor({ timeout: 60000 })
      assert(await startup.evaluate(() => window.startupCanvas === document.querySelector('canvas')))
      const business = application.windows().find(page => /\/renderer\/index\.html/.test(page.url()))
      assert(business, 'The actual workspace renderer must exist before logo entry')
      business.on('pageerror', error => errors.push({ mode, message: error.message }))
      const state = await business.evaluate(() => ({ theme: document.documentElement.dataset.theme,
        status: document.documentElement.dataset.themeStatus, dark: document.documentElement.classList.contains('dark'), fonts: document.fonts.status,
        startupManaged: window.electronAPI.startupManaged, splashCanvases: document.querySelectorAll('.startup-field canvas').length }))
      assert.equal(state.status, 'ready'); assert.equal(state.fonts, 'loaded'); assert.equal(state.dark, mode === 'dark-workspace')
      assert.equal(state.startupManaged, true); assert.equal(state.splashCanvases, 0)
      await startup.waitForEvent('close', { timeout: 10000 })
      assert(await (await application.browserWindow(business)).evaluate(window => window.isVisible()))
      await business.locator('[data-testid="app-splash"]').waitFor({ state: 'detached' })
      if (mode === 'light-onboarding') await business.locator('[data-onboarding-step]').waitFor()
      else {
        assert.equal(await business.locator('[data-onboarding-step]').count(), 0)
        assert.equal(await business.evaluate(() => window.electronAPI.getWindowWorkspace()), 'startup-fixture')
      }
      assert.equal(application.windows().filter(page => /\/startup\.html/.test(page.url())).length, 0)
      await business.screenshot({ path: join(fixture.output, `${mode}.png`) })
      samples.push({ mode, state, text: (await business.locator('body').innerText()).slice(0, 800) })
      checks.push(`real application ${mode}: final theme/fonts readiness triggers logo and preserves destination theme`)
    } finally {
      writeFileSync(join(fixture.output, `${mode}.log`), diagnostics)
      await application.close()
    }
  }
  assert.deepEqual(errors, [])
  writeFileSync(join(fixture.output, 'feedback.json'), JSON.stringify({ checks, samples, errors }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })

const { _electron } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

// Read the actual running shader, without a diagnostic API in the product.
function loadingState() {
  const canvas = document.querySelector('canvas')
  const gl = canvas?.getContext('webgl2')
  const program = gl?.getParameter(gl.CURRENT_PROGRAM)
  if (!program) return null
  const uniform = name => gl.getUniform(program, gl.getUniformLocation(program, name))
  const grid = uniform('uGrid'), cell = uniform('uCell'), origin = uniform('uOrigin'), size = uniform('uResolution')
  return { visibility: uniform('uLoading'), breath: uniform('uLoadingBreath'), color: Array.from(uniform('uLoadingColor')),
    glyphs: Array.from({ length: 7 }, (_, i) => uniform(`uLoadingGlyphs[${i}]`)),
    cols: grid[0], rows: grid[1], dx: origin[0] + grid[0] * cell[0] / 2 - size[0] / 2,
    dy: origin[1] + grid[1] * cell[1] / 2 - size[1] / 2,
    background: Array.from(uniform('uBase')) }
}

;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const checks = [], samples = [], errors = []
  for (const scene of ['slow', 'fast', 'reduced', 'no-webgl', 'context-lost', 'multiple', 'multiple-late', 'minimized', 'cancel', 'crash']) {
    const profile = join(fixture.output, scene); mkdirSync(profile)
    const env = { ...process.env, PHANERIS_CONFIG_DIR: profile }
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
    const application = await _electron.launch({ args: [fixture.entry, ...(scene === 'no-webgl' ? ['--no-webgl'] : [])], env, timeout: 30000 })
    const nativeProcess = application.process()
    let nativeLog = ''
    nativeProcess.stderr.on('data', data => { nativeLog += data.toString() })
    let tracing = false
    try {
      const page = await application.firstWindow()
      page.on('pageerror', error => errors.push({ scene, message: error.message }))
      if (scene === 'slow') { await page.context().tracing.start({ screenshots: true, snapshots: true }); tracing = true }
      await page.emulateMedia({ reducedMotion: scene === 'reduced' ? 'reduce' : 'no-preference' })
      await page.locator('[data-startup-phase="loading"]').waitFor()
      const native = await application.browserWindow(page)
      await page.waitForFunction(() => document.querySelector('canvas'))
      assert(await native.evaluate(window => window.isVisible() || new Promise(resolve => window.once('show', () => resolve(true)))))
      await page.evaluate(() => { window.startupCanvas = document.querySelector('canvas') })
      const isolated = await page.evaluate(() => ({ node: typeof window.require, api: typeof window.electronAPI,
        paper: getComputedStyle(document.querySelector('.startup-surface')).backgroundColor,
        logo: !!document.querySelector('[data-testid="startup-logo"]'), overflow: document.body.scrollWidth > innerWidth }))
      assert.deepEqual(isolated, { node: 'undefined', api: 'undefined', paper: 'rgb(255, 255, 255)', logo: false, overflow: false })
      if (scene !== 'no-webgl') {
        await page.waitForFunction(loadingState)
        const word = await page.evaluate(loadingState)
        assert.equal(word.visibility, 1)
        assert.deepEqual(word.glyphs, [11, 14, 0, 3, 8, 13, 6])
        assert(Math.abs(word.dx) <= 1 && Math.abs(word.dy) <= 1 && word.cols % 2 && word.rows % 2)
        for (let i = 0; i < 3; i++) assert(Math.abs(word.color[i] - [76, 41, 111][i] / 255) < 0.000001)
      }
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
        const wordSamples = []
        for (let i = 0; i < 32; i++) {
          wordSamples.push(await page.evaluate(loadingState))
          await page.waitForTimeout(110)
        }
        const breaths = wordSamples.map(value => value.breath)
        assert(Math.min(...breaths) < 0.32 && Math.max(...breaths) > 0.62)
        assert(wordSamples.every(value => value.visibility === 1 && value.glyphs.join() === '11,14,0,3,8,13,6'))
        await page.mouse.move(800, 500); await page.mouse.click(800, 500)
        assert.deepEqual((await page.evaluate(loadingState)).glyphs, [11, 14, 0, 3, 8, 13, 6])
        writeFileSync(join(fixture.output, 'loading-word.json'), JSON.stringify(wordSamples, null, 2))
        checks.push('slow backend retains a centered deep-violet LOADING word with a 3.2-second breath and unchanged background')
      }
      if (scene === 'no-webgl') {
        assert.equal(await page.evaluate(() => document.querySelector('canvas').getContext('webgl2')), null)
        await page.locator('.startup-fallback').waitFor()
        await page.getByTestId('startup-loading-fallback').waitFor()
        assert.equal(await page.getByTestId('startup-loading-fallback').textContent(), 'LOADING')
        await page.screenshot({ path: join(fixture.output, 'webgl-fallback.png') })
      }
      if (scene === 'context-lost') {
        await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext())
        await page.locator('.startup-fallback').waitFor()
        await page.locator('canvas').waitFor({ state: 'detached' })
        await page.getByTestId('startup-loading-fallback').waitFor()
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
        await application.evaluate(() => {
          const { presentation, targets } = globalThis.startupTest
          // Leave the inspector evaluation before starting the native animation.
          setTimeout(() => { globalThis.startupTest.readyResult = presentation.ready(targets[0].webContents.id) }, 50)
        })
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
          if (scene === 'no-webgl' || scene === 'context-lost') {
            await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="startup-loading-fallback"]')).opacity === '0')
          } else await page.waitForFunction(() => {
            const gl = document.querySelector('canvas').getContext('webgl2'), program = gl.getParameter(gl.CURRENT_PROGRAM)
            return gl.getUniform(program, gl.getUniformLocation(program, 'uLoading')) === 0
          })
        }
        await page.waitForEvent('close', { timeout: 10000 })
        const elapsed = Date.now() - start
        console.log(JSON.stringify({ scene, elapsed }))
        if (scene === 'reduced') assert(elapsed < 1500, 'Reduced motion must not wait for the logo animation')
        else if (scene !== 'slow') assert(elapsed >= 1800, `${scene}: Handoff must wait for the loading fade and real logo entrance (${elapsed}ms)`)
        samples.push({ scene, elapsed, logoClockControlled: scene === 'slow', webglCapabilityEmulated: scene === 'no-webgl', isolated })
      }
      const deadline = Date.now() + 10000
      while (!await application.evaluate(() => globalThis.startupTest.presentation.window.isDestroyed())) {
        assert(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 30))
      }
      if (scene !== 'crash') assert.equal(await application.evaluate(() => globalThis.startupTest.readyResult), true)
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
      writeFileSync(join(fixture.output, `${scene}-native.log`), nativeLog)
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
      const revealing = startup.locator('[data-startup-phase="revealing"]').waitFor({ timeout: 60000 })
      const initial = await startup.evaluate(() => {
        window.startupCanvas = document.querySelector('canvas')
        return { logo: !!document.querySelector('[data-testid="startup-logo"]'),
          paper: getComputedStyle(document.querySelector('.startup-surface')).backgroundColor }
      })
      assert.deepEqual(initial, { logo: false, paper: 'rgb(255, 255, 255)' })
      await revealing
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

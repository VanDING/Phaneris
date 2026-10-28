const { firstBusinessWindow } = require('./electron-windows.cjs')
/** Production Electron main + preload + renderer; no fake browser theme delivery. */
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { _electron } = require('playwright')
const { createServer } = require('node:http')
;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const app = await _electron.launch({ args: [join(fixture.root, 'apps/electron')], cwd: fixture.root, env, timeout: 60_000 })
  const checks = [], samples = [], errors = []
  const website = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body>Owned website content</body>') })
  await new Promise(resolve => website.listen(0, '127.0.0.1', resolve))
  const page = await firstBusinessWindow(app, { timeout: 60_000 }); page.on('pageerror', error => errors.push(error.message))
  const mainWindow = await app.browserWindow(page)
  const viewStates = () => app.evaluate(async ({ webContents }) => {
    const views = webContents.getAllWebContents().filter(view => /browser-(?:toolbar|empty-state)\.html/.test(view.getURL()))
    return Promise.all(views.map(async view => ({ url: view.getURL(), value: await view.executeJavaScript(`({id: document.documentElement.dataset.theme, status: document.documentElement.dataset.themeStatus, mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light', revision: document.documentElement.dataset.themeRevision, color: getComputedStyle(document.body).color})`) })))
  })
  const waitViews = async (id, mode) => {
    const deadline = Date.now() + 30000
    let states
    do { states = await viewStates(); if (states.length >= 2 && states.every(view => view.value.id === id && view.value.status === 'ready' && view.value.mode === mode)) return states
      await new Promise(resolve => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    throw new Error('Native view delivery did not settle: ' + JSON.stringify(states))
  }
  try {
    await page.waitForFunction(() => document.documentElement.dataset.clientPlatform === 'electron', null, { timeout: 90_000 })
    await page.waitForFunction(() => window.electronAPI?.getThemePreferences, null, { timeout: 30_000 })
    await page.evaluate(() => window.electronAPI.setThemePreferences({ mode: 'light', colorTheme: 'ink', font: 'inter' }))
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'ink' && document.documentElement.dataset.themeStatus === 'ready')
    checks.push('native authoritative preferences apply before acceptance')
    const id = await page.evaluate(() => window.electronAPI.browserPane.create({ workspaceId: 'fixture', show: false }))
    samples.push(await waitViews('ink', 'light')); checks.push('real main preload deliver initial theme to toolbar and empty state')
    for (const theme of ['default', 'ink', 'geek', 'cyberpunk-2077']) for (const mode of ['light', 'dark']) {
      await page.evaluate(({ theme, mode }) => window.electronAPI.setThemePreferences({ mode, colorTheme: theme, font: 'inter' }), { theme, mode })
      const actual = theme === 'geek' || theme === 'cyberpunk-2077' ? 'dark' : mode
      samples.push({ theme, mode, views: await waitViews(theme, actual) }); checks.push(`native theme delivery ${theme}/${mode}`)
    }
    await mainWindow.evaluate(window => { window.setContentSize(1280, 900); window.webContents.setZoomFactor(2) })
    // Native resize and Chromium zoom reach the renderer asynchronously; two
    // animation frames can still observe the old viewport on a busy runner.
    let geometry, native
    try {
      await page.waitForFunction(() => Math.abs(innerWidth - 640) <= 1, null, { timeout: 30_000 })
    } finally {
      geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
        panels: [...document.querySelectorAll('[data-panel-role]')].map(element => ({ role: element.getAttribute('data-panel-role'), x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })) }))
      native = await mainWindow.evaluate(window => ({ contentSize: window.getContentSize(), zoomFactor: window.webContents.getZoomFactor() }))
      samples.push({ zoom: 2, native, geometry })
    }
    assert.equal(native.contentSize[0], 1280); assert.equal(native.zoomFactor, 2)
    assert(Math.abs(geometry.width - 640) <= 1); assert(geometry.scroll <= geometry.viewport + 1)
    // capturePage records the full native framebuffer; Page.screenshot can crop
    // Electron's zoomed physical window to its CSS viewport.
    const zoomImage = await mainWindow.evaluate(async window => (await window.webContents.capturePage()).toPNG().toString('base64'))
    writeFileSync(join(fixture.output, 'native-zoom-200.png'), Buffer.from(zoomImage, 'base64')); checks.push('real Chromium browser zoom 200 percent reflows')
    await mainWindow.evaluate(window => window.webContents.setZoomFactor(1))
    const foreign = `http://127.0.0.1:${website.address().port}/owned`
    await page.evaluate(({ id, foreign }) => window.electronAPI.browserPane.navigate(id, foreign), { id, foreign })
    const leaked = await app.evaluate(async ({ webContents }, foreign) => {
      const view = webContents.getAllWebContents().find(view => view.getURL() === foreign)
      return view ? view.executeJavaScript('typeof window.__phanerisBrowserTheme') : 'undefined'
    }, foreign)
    assert.equal(leaked, 'undefined'); checks.push('foreign page receives no private theme payload')
    assert.deepEqual(errors, []); checks.push('native renderer has no unhandled errors')
    await page.screenshot({ path: join(fixture.output, 'native-theme.png') })
  } finally {
    writeFileSync(join(fixture.output, 'theme-native.json'), JSON.stringify({ checks, samples, errors, platform: process.platform, electron: await app.evaluate(() => process.versions.electron),
      scope: 'Production bundles, real Electron main/preload and BrowserViews, disposable config, local RPC; no signed installer acceptance.' }, null, 2))
    await app.close()
    await new Promise(resolve => website.close(resolve))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

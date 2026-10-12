/** Actual native app; no mocked shell components or theme delivery. */
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { _electron } = require('playwright')

;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const app = await _electron.launch({ args: [join(fixture.root, 'apps/electron')], cwd: fixture.root, env, timeout: 60_000 })
  const checks = [], targets = [], samples = [], errors = []
  const page = await app.firstWindow({ timeout: 60_000 })
  const nativeWindow = await app.browserWindow(page)
  page.on('pageerror', error => errors.push(error.message))
  await page.context().tracing.start({ screenshots: true, snapshots: true })
  const target = (id, condition, actual) => {
    targets.push({ id, passed: Boolean(condition), actual })
    if (!fixture.baseline) assert(condition, `${id}: ${JSON.stringify(actual)}`)
    checks.push(`${fixture.baseline ? 'observed' : 'verified'} ${id}`)
  }
  const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  const choose = async (theme, mode = 'light') => {
    await page.evaluate(({ theme, mode }) => window.electronAPI.setThemePreferences({ mode, colorTheme: theme, font: 'inter' }), { theme, mode })
    await page.waitForFunction(theme => (document.documentElement.dataset.theme ?? 'default') === theme && document.documentElement.dataset.themeStatus === 'ready', theme)
    await settle()
  }
  const measure = () => page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect(), css = getComputedStyle(element)
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2,
        radius: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius],
        shadow: css.boxShadow, fontSize: css.fontSize, padding: [css.paddingLeft, css.paddingRight], outline: [css.outlineStyle, css.outlineWidth] }
    }
    return { platform: navigator.platform, theme: document.documentElement.dataset.theme,
      width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebar: box('[data-panel-role="sidebar"]'), button: box('.sidebar-new-session'), newIcon: box('.sidebar-new-session > svg'),
      navTitle: box('[data-panel-role="navigator"] h1'), contentTitle: box('[data-panel-role="content"] h1'),
      row: box('.sidebar-nav-button'), rowIcon: box('.sidebar-nav-button > span:first-child'),
      navigator: box('[data-panel-role="navigator"]'), content: box('[data-panel-role="content"]'),
      profile: box('.sidebar-profile-trigger'), settings: box('.sidebar-settings-trigger'),
      border: getComputedStyle(document.documentElement).getPropertyValue('--border').trim(),
      density: getComputedStyle(document.documentElement).getPropertyValue('--theme-density').trim(),
      focus: { element: document.activeElement?.outerHTML.slice(0, 700), visible: document.activeElement?.matches(':focus-visible'),
        outline: document.activeElement ? getComputedStyle(document.activeElement).outline : null } }
  })
  const snapshot = async id => {
    await settle(); const sample = await measure(); samples.push({ id, ...sample })
    await page.mouse.move(0, 0)
    if (id === 'native-zoom-200') {
      const png = await nativeWindow.evaluate(async window => (await window.webContents.capturePage()).toPNG().toString('base64'))
      writeFileSync(join(fixture.output, `${id}.png`), Buffer.from(png, 'base64'))
    } else await page.screenshot({ path: join(fixture.output, `${id}.png`) })
    return sample
  }
  const toggleSidebar = () => page.getByRole('button', { name: /^(Toggle Sidebar|切换侧栏)$/ }).first().click()
  try {
    await page.waitForFunction(() => document.documentElement.dataset.clientPlatform === 'electron', null, { timeout: 90_000 })
    await nativeWindow.evaluate(window => window.setContentSize(1440, 1000))
    await page.getByText(fixture.name, { exact: true }).first().click({ timeout: 60_000 })
    await page.locator('[data-panel-role="content"] h1').waitFor()
    await choose('default')
    const initial = await snapshot('default-light-expanded')
    target('three first-row centers align', Math.abs(initial.button.centerY - initial.navTitle.centerY) <= 1 && Math.abs(initial.button.centerY - initial.contentTitle.centerY) <= 1, initial)
    target('new-session top aligns with panels', Math.abs(initial.button.y - initial.navigator.y) <= 1, initial)
    target('expanded default width 200', Math.abs(initial.sidebar.width - 200) <= 1, initial.sidebar)
    target('sidebar has no extra navigator seam', Math.abs(initial.navigator.x - initial.sidebar.x - initial.sidebar.width) < .1, initial)
    target('navigation rows 28', Math.abs(initial.row.height - 28) <= 1, initial.row)
    target('navigation icons 16', Math.abs(initial.rowIcon.width - 16) <= .1, initial.rowIcon)
    target('new session symmetric insets', Math.abs(initial.button.x - initial.sidebar.x - (initial.sidebar.x + initial.sidebar.width - initial.button.x - initial.button.width)) <= 1, initial)
    target('navigation and first-row insets match', Math.abs(initial.row.x - initial.button.x) <= 1 && Math.abs(initial.row.width - initial.button.width) <= 1, initial)
    const borderRGB = await page.evaluate(() => {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim(); context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    })
    target('default light neutral border', Math.max(...borderRGB) - Math.min(...borderRGB) <= 3, borderRGB)
    const shadowAlpha = [...initial.navigator.shadow.matchAll(/(?:rgba\([^)]*,\s*|color\([^)]*\/\s*)([\d.]+)\)/g)].map(value => Number(value[1]))
    target('default light visible soft panel shadow', shadowAlpha.some(value => value >= .07), initial.navigator.shadow)
    const nativeRadius = process.platform === 'darwin' ? 10 : 6
    target('native default panel radius', Math.abs(parseFloat(initial.navigator.radius[0]) - nativeRadius) < .01, initial.navigator.radius)
    target('native default edge radius', Math.abs(parseFloat(initial.content.radius[2]) - (process.platform === 'darwin' ? 8 : 6)) < .01, initial.content.radius)
    const dragSash = async (name, delta) => {
      const sash = page.getByRole('slider', { name, exact: true })
      const rect = await sash.boundingBox()
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
      await page.mouse.move(x, y); await page.mouse.down()
      await page.mouse.move(x + delta, y, { steps: 4 }); await page.mouse.up(); await settle()
    }
    await dragSash('调整侧栏宽度', 32)
    target('sidebar drag follows pointer delta without seam jump', Math.abs((await measure()).sidebar.width - 232) < 1, await measure())
    await dragSash('调整侧栏宽度', -32)
    await dragSash('调整导航列表宽度', 32)
    target('navigator drag follows pointer delta without seam jump', Math.abs((await measure()).navigator.width - 332) < 1, await measure())
    await dragSash('调整导航列表宽度', -32)
    await toggleSidebar()
    await page.waitForFunction(() => document.querySelector('.sidebar-navigation').hasAttribute('data-collapsed'))
    await page.waitForTimeout(350)
    const rail = await snapshot('default-light-collapsed')
    target('collapsed width 48 with breathing room', Math.abs(rail.sidebar.width - 48) <= 1, rail.sidebar)
    const visibleRailCenter = (Math.max(0, rail.sidebar.x) + rail.navigator.x - 1) / 2
    target('icons centered in the visible rail including its boundary', Math.abs(rail.rowIcon.centerX - visibleRailCenter) <= .6 && Math.abs(rail.newIcon.centerX - visibleRailCenter) <= .6, { visibleRailCenter, rail })
    target('collapsed controls are 24px squares', [rail.row, rail.button, rail.profile, rail.settings].every(box => Math.abs(box.width - 24) < .1 && Math.abs(box.height - 24) < .1), rail)
    target('state-specific icon alignment', Math.abs(rail.rowIcon.centerX - rail.sidebar.centerX) <= .1 && Math.abs(initial.rowIcon.centerX - initial.newIcon.centerX) <= .1, { initial: initial.rowIcon, rail: rail.rowIcon, sidebar: rail.sidebar })
    const rowGap = await page.locator('nav[aria-label="Main navigation"]').evaluate(element => parseFloat(getComputedStyle(element).rowGap))
    target('collapsed navigation has 8px gaps', Math.abs(rowGap - 8) < .1, rowGap)
    target('footer icons centered', Math.abs(rail.settings.centerX - rail.sidebar.centerX) <= .1 && Math.abs(rail.profile.centerX - rail.sidebar.centerX) <= .1, rail)
    await dragSash('调整导航列表宽度', 32)
    target('collapsed navigator drag uses same geometry', Math.abs((await measure()).navigator.width - 332) < 1, await measure())
    await dragSash('调整导航列表宽度', -32)
    // The app uses explicit focus zones; a driver .focus() does not enter one.
    // Exercise the actual focus and fold shortcuts before arrow navigation.
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+1`); await settle()
    await page.keyboard.press(`${modifier}+b`); await page.waitForTimeout(350)
    await page.keyboard.press('ArrowDown')
    await settle()
    const focused = await page.evaluate(() => ({ inSidebar: Boolean(document.activeElement?.closest('.sidebar-navigation')),
      visible: document.activeElement?.matches(':focus-visible'), outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : null }))
    target('collapsed keyboard focus visible', focused.inSidebar && focused.visible && focused.outline !== 'none', { focused, shell: await measure() })
    await page.locator('.sidebar-profile-trigger').click(); await page.getByRole('dialog').waitFor()
    checks.push('collapsed profile opens'); await page.keyboard.press('Escape')
    await toggleSidebar(); await page.waitForTimeout(350)
    await choose('default', 'dark'); await snapshot('default-dark-expanded'); checks.push('default dark retains own material')
    for (const [theme, radius] of [['ink', 2], ['geek', 4], ['cyberpunk-2077', 2]]) {
      await choose(theme); const sample = await snapshot(`${theme}-expanded`)
      target(`${theme} authored panel radius preserved`, parseFloat(sample.navigator.radius[0]) === radius && parseFloat(sample.content.radius[2]) === radius, sample)
    }
    await choose('default')
    const sidebarSash = page.getByRole('slider', { name: '调整侧栏宽度', exact: true })
    const navigatorSash = page.getByRole('slider', { name: '调整导航列表宽度', exact: true })
    const resizeByKey = async key => { await page.keyboard.press(key); await page.waitForTimeout(350); await settle() }
    await sidebarSash.focus(); await resizeByKey('ArrowRight')
    target('sidebar width slider keyboard adjusts and persists', Math.abs((await measure()).sidebar.width - 216) < 1 && await page.evaluate(() => JSON.parse(localStorage.getItem('craft-sidebar-width')) === 216), await measure())
    const sashFocus = await sidebarSash.evaluate(element => ({ visible: element.matches(':focus-visible'), outline: getComputedStyle(element).outlineStyle }))
    target('width slider keyboard focus visible', sashFocus.visible && sashFocus.outline !== 'none', sashFocus)
    await resizeByKey('Home')
    target('sidebar width slider keyboard lower bound', Math.abs((await measure()).sidebar.width - 180) < 1, await measure())
    await resizeByKey('End')
    target('sidebar width slider keyboard upper bound', Math.abs((await measure()).sidebar.width - 320) < 1, await measure())
    await navigatorSash.focus(); await resizeByKey('ArrowRight')
    target('navigator width slider keyboard adjusts and persists', Math.abs((await measure()).navigator.width - 316) < 1 && await page.evaluate(() => JSON.parse(localStorage.getItem('craft-session-list-width')) === 316), await measure())
    await resizeByKey('Home')
    target('navigator width slider keyboard lower bound', Math.abs((await measure()).navigator.width - 240) < 1, await measure())
    await resizeByKey('End')
    target('navigator width slider keyboard upper bound', Math.abs((await measure()).navigator.width - 480) < 1, await measure())
    await page.evaluate(() => localStorage.setItem('craft-sidebar-width', '256'))
    await page.evaluate(() => localStorage.removeItem('craft-session-list-width'))
    await page.reload(); await page.locator('.sidebar-new-session').waitFor(); await settle()
    target('saved width survives refresh', Math.abs((await measure()).sidebar.width - 256) <= 1, await measure())
    await page.evaluate(() => localStorage.removeItem('craft-sidebar-width'))
    await page.reload(); await page.locator('.sidebar-new-session').waitFor(); await settle()
    await nativeWindow.evaluate(window => window.webContents.setZoomFactor(2))
    await settle(); const zoom = await snapshot('native-zoom-200')
    target('200 percent native zoom reflows', zoom.overflow <= 1 && zoom.width <= 721, zoom)
    await nativeWindow.evaluate(window => window.webContents.setZoomFactor(1))
    await page.evaluate(() => document.documentElement.style.setProperty('font-size', '30px'))
    await settle(); const text = await snapshot('large-text')
    target('large text rows expand', text.row.height >= 44 && text.overflow <= 1 && text.button.height >= 50, text)
    await toggleSidebar(); await page.waitForTimeout(350)
    const largeRail = await snapshot('large-text-collapsed')
    target('large root text retains square rail', [largeRail.row, largeRail.button, largeRail.profile, largeRail.settings].every(box => Math.abs(box.width - box.height) < .1), largeRail)
    await toggleSidebar(); await page.waitForTimeout(350)
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'))
    await nativeWindow.evaluate(window => window.setContentSize(1440, 600))
    await settle(); const short = await snapshot('short-window')
    target('scrolling navigation retains symmetric insets', Math.abs(short.row.x - short.button.x) <= 1 && Math.abs(short.row.width - short.button.width) <= 1, short)
    await page.locator('.sidebar-nav-button').last().scrollIntoViewIfNeeded()
    target('last navigation item reachable', await page.locator('.sidebar-nav-button').last().isVisible(), await measure())
    await nativeWindow.evaluate(window => window.setContentSize(1440, 1000))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await page.waitForFunction(() => matchMedia('(pointer: coarse)').matches)
    await toggleSidebar(); await page.waitForTimeout(350)
    const touch = await snapshot('touch-collapsed')
    target('touch rail and controls remain usable', Math.abs(touch.sidebar.width - 60) <= 1 && touch.row.height >= 44 && touch.row.width >= 44 && touch.settings.width >= 44 && touch.profile.height >= 44, touch)
    await toggleSidebar(); await page.waitForTimeout(350)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach()
    await choose('startup-small')
    await page.evaluate(() => localStorage.setItem('craft-theme', JSON.stringify({ version: 3, mode: 'light', colorTheme: 'default', font: 'inter' })))
    await page.context().addInitScript(() => {
      window.__shellStartupFrames = []
      const sample = () => {
        const header = document.querySelector('.sidebar-new-session'), splash = document.querySelector('[data-testid="app-splash"], .z-splash')
        if (header) window.__shellStartupFrames.push({ time: performance.now(), font: getComputedStyle(document.documentElement).fontSize,
          headerHeight: header.getBoundingClientRect().height, theme: document.documentElement.dataset.theme ?? 'default',
          cover: splash ? Number(getComputedStyle(splash).opacity) : 0 })
        if (window.__shellStartupFrames.length < 600) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'startup-small' && document.documentElement.dataset.themeStatus === 'ready')
    await page.locator('[data-testid="app-splash"]').waitFor({ state: 'detached' })
    await page.waitForTimeout(200)
    const startup = await page.evaluate(() => window.__shellStartupFrames)
    writeFileSync(join(fixture.output, 'startup-frames.json'), JSON.stringify(startup, null, 2))
    const revealed = startup.filter(frame => frame.cover < .95)
    target('startup reveals only the final persisted size', revealed.length > 0 && revealed.every(frame => frame.font === '13px' && frame.theme === 'startup-small'), { revealed: revealed.length, fonts: [...new Set(revealed.map(frame => frame.font))], themes: [...new Set(revealed.map(frame => frame.theme))] })
    await snapshot('startup-settled')
    await choose('default')
    await page.context().addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'Win32' }))
    await page.reload(); await page.locator('.sidebar-new-session').waitFor(); await settle()
    const windows = await snapshot('windows-policy')
    target('Windows default radius stays 6', parseFloat(windows.navigator.radius[0]) === 6 && parseFloat(windows.content.radius[2]) === 6, windows)
    assert.deepEqual(errors, []); checks.push('no native renderer errors')
  } finally {
    writeFileSync(join(fixture.output, 'shell-visual.json'), JSON.stringify({ baseline: fixture.baseline, checks, targets, samples, errors, platform: process.platform,
      scope: 'Real production Electron main/preload/renderer, seeded local conversation. Windows policy simulated; native Windows compositor untested.' }, null, 2))
    await page.context().tracing.stop({ path: join(fixture.output, 'trace.zip') })
    await app.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

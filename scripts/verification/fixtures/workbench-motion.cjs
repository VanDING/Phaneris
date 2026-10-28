const { firstBusinessWindow } = require('./electron-windows.cjs')
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { _electron } = require('playwright')

/** Shared with shell-visual so its default run also guards Workbench motion. */
async function verifyWorkbenchMotion(page, nativeWindow, fixture) {
  const checks = [], observations = []
  const check = (id, passed, actual) => {
    observations.push({ id, passed, actual })
    if (!fixture.baseline) assert(passed, `${id}: ${JSON.stringify(actual)}`)
    checks.push(id)
  }
  const launcher = label => page.getByRole('button', { name: label, exact: true }).first()
  const labels = await page.locator('button[aria-label]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  writeFileSync(join(fixture.output, 'workbench-labels.json'), JSON.stringify(labels, null, 2))
  const files = labels.includes('文件') ? '文件' : 'Files'
  const capture = async (id, button) => {
    const frames = await button.evaluate(element => new Promise(resolve => {
      const start = performance.now(), frames = []
      const sample = () => {
        const panels = [...document.querySelectorAll('[data-surface-id]')]
        const workbench = panels.find(node => !node.dataset.surfaceId.startsWith('conversation:') && node.querySelector('[role="tablist"]'))
        const primary = panels.find(node => node !== workbench && !node.closest('[inert]'))
        const width = node => node?.getBoundingClientRect().width ?? 0
        frames.push({ time: performance.now() - start, workbench: width(workbench), primary: width(primary),
          mounted: !!workbench, row: document.querySelector('[data-workbench-row]')?.getBoundingClientRect().width, opacity: workbench ? getComputedStyle(workbench).opacity : 0, sash: document.querySelector('[role="separator"][aria-valuenow]')?.getAttribute('aria-valuenow') })
        if (performance.now() - start < 550) requestAnimationFrame(sample)
        else resolve(frames)
      }
      sample()
      element.click()
    }))
    writeFileSync(join(fixture.output, `${id}-frames.json`), JSON.stringify(frames, null, 2))
    return frames
  }
  try {
    const open = await capture('workbench-open', launcher(files))
    const end = open.at(-1).workbench
    check('open has intermediate painted widths', open.some(frame => frame.workbench > 1 && frame.workbench < end - 1), open.map(f => [Math.round(f.time), f.workbench]))
    check('open width never decreases', open.every((frame, index) => index === 0 || frame.workbench >= open[index - 1].workbench - .5), open)
    const firstMounted = open.find(frame => frame.mounted)
    check('open mounts at zero width', firstMounted?.workbench < 1, firstMounted)
    check('open never pauses at the Workbench floor', !open.some((frame, index) => index && frame.workbench > 1 && frame.workbench < end - 1 && Math.abs(frame.workbench - open[index - 1].workbench) < .1), 'workbench-open-frames.json')
    check('open keeps both widths complementary', open.every(frame => !frame.row || Math.abs(frame.primary + frame.workbench + 6 * frame.workbench / end - frame.row) < 1), 'workbench-open-frames.json')
    check('panel content has no entrance opacity or transform', await page.locator('[data-workbench-dock] [data-panel-role="content"]').evaluate(node => getComputedStyle(node).opacity === '1' && getComputedStyle(node).transform === 'none'), 'directly visible content')
    await page.screenshot({ path: join(fixture.output, 'workbench-open.png') })
    const buttons = await page.locator('[data-surface-id] [role="tablist"] button[aria-label]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
    writeFileSync(join(fixture.output, 'workbench-buttons.json'), JSON.stringify(buttons, null, 2))
    const closeButton = page.getByRole('button', { name: /Collapse|收起|折叠/i }).last()
    const close = await capture('workbench-close', closeButton)
    check('close has intermediate painted widths', close.some(frame => frame.workbench > 1 && frame.workbench < end - 1), close)
    check('close width never increases', close.every((frame, index) => index === 0 || frame.workbench <= close[index - 1].workbench + .5), close)
    check('close removes Workbench', close.at(-1).workbench === 0, close.at(-1))
    await page.screenshot({ path: join(fixture.output, 'workbench-closed.png') })
    if (fixture.baseline || fixture.quick) return checks

    const geometry = () => page.evaluate(() => {
      const dock = document.querySelector('[data-workbench-dock]')
      const row = document.querySelector('[data-workbench-row]')
      const primary = row?.firstElementChild
      const sash = dock?.querySelector('[role="separator"]')
      const rect = node => { const r = node?.getBoundingClientRect(); return r && { x: r.x, right: r.right, width: r.width } }
      return { row: rect(row), dock: rect(dock), primary: rect(primary),
        value: Number(sash?.getAttribute('aria-valuenow')), max: Number(sash?.getAttribute('aria-valuemax')) }
    })
    const openFiles = async () => { await launcher(files).click(); await page.waitForTimeout(350) }
    const closeFiles = async () => { await page.getByRole('button', { name: /Collapse Workbench|收起工作台/i }).click(); await page.waitForTimeout(350) }
    await openFiles()
    const sash = page.locator('[data-workbench-dock] [role="separator"]')
    await sash.press('Home'); await page.waitForTimeout(350)
    let g = await geometry()
    check('keyboard Home reaches transcript floor', Math.abs(g.primary.width - 380) < .1 && g.value === 380, g)
    await sash.press('End'); await page.waitForTimeout(350)
    g = await geometry()
    check('keyboard End reaches row ceiling and Workbench floor', Math.abs(g.dock.width - 360) < .1 && Math.abs(g.primary.width - g.max) < .1 && Math.abs(g.value - g.primary.width) < .1, g)
    check('transcript can exceed half the content row', g.primary.width > g.row.width / 2, g)
    await page.screenshot({ path: join(fixture.output, 'workbench-sash-maximum.png') })
    await sash.press('ArrowLeft'); await page.waitForTimeout(350)
    g = await geometry()
    check('keyboard arrows use the rendered boundary', Math.abs(g.primary.width - (g.max - 16)) < .1, g)
    const box = await sash.boundingBox(), x = box.x, y = box.y + box.height / 2
    await page.mouse.move(x, y); await page.mouse.down()
    const drag = []
    for (const delta of [-24, -64, -104]) {
      await page.mouse.move(x + delta, y)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      drag.push(await geometry())
    }
    await page.mouse.up()
    check('drag snaps to each pointer position without easing', drag.every((sample, index) => Math.abs(sample.primary.width - (g.primary.width + [-20, -60, -100][index])) < .5 && Math.abs(sample.value - sample.primary.width) < .5), drag)
    // A measured ceiling can exceed the legacy 1600px fallback on wide windows.
    await nativeWindow.evaluate(window => window.setContentSize(2640, 1000)); await page.waitForTimeout(150)
    await sash.press('End'); await page.waitForTimeout(350)
    g = await geometry()
    check('wide-window sash reaches its measured ceiling', g.max > 1600 && Math.abs(g.primary.width - g.max) < .1 && Math.abs(g.dock.width - 360) < .1, g)
    await page.screenshot({ path: join(fixture.output, 'workbench-wide-window.png') })
    await nativeWindow.evaluate(window => window.setContentSize(1640, 1000)); await page.waitForTimeout(150)
    await sash.press('Home'); await page.waitForTimeout(350)
    // Window resize: inspect every paint after the first updated row measurement.
    await page.evaluate(() => {
      window.__resizeFrames = []
      window.__stopResize = false
      const sample = () => {
        const row = document.querySelector('[data-workbench-row]'), dock = document.querySelector('[data-workbench-dock]')
        if (row && dock) window.__resizeFrames.push({ time: performance.now(), row: row.getBoundingClientRect().width,
          primary: row.firstElementChild.getBoundingClientRect().width, dock: dock.getBoundingClientRect().width })
        if (!window.__stopResize) requestAnimationFrame(sample)
      }
      sample()
    })
    for (const width of [1440, 1540, 1640]) { await nativeWindow.evaluate((window, width) => window.setContentSize(width, 1000), width); await page.waitForTimeout(90) }
    const resizeFrames = await page.evaluate(() => { window.__stopResize = true; return window.__resizeFrames })
    writeFileSync(join(fixture.output, 'workbench-window-resize-frames.json'), JSON.stringify(resizeFrames, null, 2))
    // ResizeObserver runs after rAF: allow that measurement frame, then demand the exact budget.
    check('window resize snaps without a tween tail', resizeFrames.every((frame, index) => index === 0 || Math.abs(frame.row - resizeFrames[index - 1].row) > .1 || Math.abs(frame.primary + frame.dock + 6 - frame.row) < .5), resizeFrames)
    await page.screenshot({ path: join(fixture.output, 'workbench-resized.png') })
    await page.getByRole('button', { name: /Expand to full width|展开至全宽/i }).click(); await page.waitForTimeout(700)
    g = await geometry()
    check('expanded Workbench fills the content row', g.primary.width === 0 && Math.abs(g.dock.width - g.row.width) < .1, g)
    await page.screenshot({ path: join(fixture.output, 'workbench-full-width.png') })
    await page.keyboard.press('Escape'); await page.waitForTimeout(700)
    g = await geometry()
    check('Escape restores the companion layout', g.primary.width >= 380 && g.dock.width >= 360, g)
    await closeFiles()

    // The product intentionally presents only the active conversation while a
    // Workbench is open, and restores the foreground group on collapse.
    if (fixture.names?.length > 1) {
      for (let count = 2; count <= fixture.names.length; count++) {
        await page.getByText(fixture.names[count - 1], { exact: true }).first().click({ modifiers: ['Control', 'Shift'] })
        await page.waitForTimeout(400)
        check(`${count} foreground conversations share the row`, await page.locator('[data-active-conversation]').count() === count, count)
        await page.screenshot({ path: join(fixture.output, `workbench-${count}-conversations.png`) })
        const frames = await capture(`workbench-${count}-open`, launcher(files))
        check(`${count} conversation Workbench opens monotonically`, frames.at(-1).workbench >= 360 && frames.every((frame, index) => !index || frame.workbench >= frames[index - 1].workbench - .5), `workbench-${count}-open-frames.json`)
        await page.screenshot({ path: join(fixture.output, `workbench-${count}-companion.png`) })
        await closeFiles()
        check(`${count} conversations return after collapse`, await page.locator('[data-active-conversation]').count() === count, count)
      }
      // Selecting a session normally returns to a single conversation.
      await page.getByText(fixture.names[0], { exact: true }).first().click(); await page.waitForTimeout(400)
    }
    for (const label of [labels.includes('运行') ? '运行' : 'Run', labels.includes('终端') ? '终端' : 'Terminal']) {
      const frames = await capture(`workbench-${label === '运行' || label === 'Run' ? 'run' : 'terminal'}-open`, launcher(label))
      check(`${label} opens monotonically`, frames.at(-1).workbench >= 360 && frames.every((frame, index) => !index || frame.workbench >= frames[index - 1].workbench - .5), frames.map(f => f.workbench))
      await closeFiles()
    }
    await nativeWindow.evaluate(window => { window.setMinimumSize(320, 480); window.setContentSize(600, 900) })
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+Shift+e'); await page.waitForTimeout(700)
    const compact = await page.locator('[data-surface-id][data-compact]').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, hidden: !!node.closest('[inert]') })))
    check('compact keeps replacement layers at full width', compact.length >= 2 && compact.every(panel => Math.abs(panel.width - compact[0].width) < .1) && compact.some(panel => panel.hidden), compact)
    check('compact uses no row-derived dock', await page.locator('[data-workbench-row]').count() === 0, 'compact replacement layers')
    await page.screenshot({ path: join(fixture.output, 'workbench-compact.png') })
    await closeFiles(); await page.waitForTimeout(350)
    await nativeWindow.evaluate(window => window.setContentSize(1640, 1000)); await page.waitForTimeout(500)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload(); await page.locator('.sidebar-new-session').waitFor(); await page.waitForTimeout(500)
    const reducedOpen = await capture('workbench-reduced-open', launcher(files))
    const reducedWidth = reducedOpen.at(-1).workbench
    check('reduced motion opens instantly', reducedWidth >= 360 && reducedOpen.every(frame => frame.workbench < .1 || Math.abs(frame.workbench - reducedWidth) < .1), reducedOpen.map(f => f.workbench))
    const reducedClose = await capture('workbench-reduced-close', page.getByRole('button', { name: /Collapse Workbench|收起工作台/i }))
    check('reduced motion closes instantly', reducedClose.at(-1).workbench === 0 && reducedClose.every(frame => frame.workbench < .1 || Math.abs(frame.workbench - reducedWidth) < .1), reducedClose.map(f => f.workbench))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  } finally {
    writeFileSync(join(fixture.output, 'workbench-motion.json'), JSON.stringify({ checks, observations }, null, 2))
  }
  return checks
}
module.exports = { verifyWorkbenchMotion }

if (require.main === module) (async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const app = await _electron.launch({ args: [join(fixture.root, 'apps/electron')], cwd: fixture.root, env, timeout: 60_000, recordVideo: { dir: fixture.output, size: { width: 1640, height: 1000 } } })
  let video
  try {
    const page = await firstBusinessWindow(app, { timeout: 60_000 })
    video = page.video()
    const window = await app.browserWindow(page)
    await window.evaluate(window => window.setContentSize(1640, 1000))
    await page.getByText(fixture.names[0], { exact: true }).first().click({ timeout: 60_000 })
    await page.locator('[data-panel-role="content"] h1').waitFor()
    await page.locator('[data-testid="app-splash"]').waitFor({ state: 'detached' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await verifyWorkbenchMotion(page, window, fixture)
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
    // Keep video locally, outside the portable JSON/PNG evidence manifest.
    if (video) { await video.saveAs(join(fixture.config, 'workbench-motion.webm')); await video.delete() }
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

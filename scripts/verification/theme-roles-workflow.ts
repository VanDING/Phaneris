/** TC11–TC15. Failure matrix and probes precede role migration. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildFixturePage } from './fixture-bundle'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'

await verificationWorkflow('theme-roles', async run => {
  const root = resolve(import.meta.dir, '../..')
  const checks: { id: string; passed: boolean; error?: string }[] = [], samples: unknown[] = [], errors: string[] = []
  const sources = ['scripts/verification/fixtures/theme-roles-css/electron.css', 'scripts/verification/fixtures/theme-roles-css/viewer.css', 'scripts/verification/fixtures/theme-roles-css/webui.css',
    'apps/electron/src/renderer/components/ui/button.tsx', 'packages/ui/src/styles/controls.css', 'packages/ui/src/styles/typography.css',
    'packages/ui/src/lib/layout.ts', 'packages/ui/src/components/markdown/CodeBlock.tsx', 'apps/viewer/src/components/Header.tsx',
    'apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx', 'apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx',
    'scripts/verification/fixtures/theme-roles.tsx', 'scripts/verification/theme-roles-workflow.ts']
  run.json('source-hashes.json', Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])))
  const launched = await launchWorkflowBrowser(), server = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/theme-roles.tsx' })
  const base = server.url
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce', hasTouch: true, colorScheme: 'light' })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await context.tracing.start({ screenshots: true, snapshots: true })
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  async function check(id: string, fn: () => Promise<void>) { try { await fn(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) } }
  const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  async function choose(id: string, mode: 'light' | 'dark', fontSize = '15px', density = 'comfortable') {
    await page.evaluate(({ id, mode, fontSize, density }) => window.themeRoles.choose(id, mode, { fontSize, density: density as 'comfortable' }), { id, mode, fontSize, density })
    await page.waitForFunction(id => document.documentElement.dataset.theme === id && document.documentElement.dataset.themeStatus === 'ready', id)
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
  }
  const geometry = () => page.evaluate(() => {
    const measure = (selector: string) => { const element = document.querySelector(selector)!, rect = element.getBoundingClientRect(), css = getComputedStyle(element)
      return { width: rect.width, height: rect.height, fontSize: parseFloat(css.fontSize), left: rect.x + parseFloat(css.paddingLeft), right: rect.x + rect.width - parseFloat(css.paddingRight) } }
    return { zoom: Number(getComputedStyle(document.documentElement).zoom) || 1, coarse: matchMedia('(pointer: coarse)').matches,
      icon: measure('[data-testid="icon"]'), button: measure('[data-testid="button"]'), ui: measure('[data-testid="ui-text"]'), reading: measure('[data-testid="reading-text"]'),
      transcript: measure('[data-testid="transcript-column"]'), composer: measure('[data-testid="composer"] > div'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  try {
    run.json('preparation.json', await warmThemePage(context, `${base}?css=electron.css`, '[data-roles-ready]'))
    for (const host of ['electron', 'viewer', 'webui']) {
      await gotoWithRetry(page, `${base}?css=${host}.css`)
      await page.locator('[data-roles-ready]').waitFor(); assert(await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      for (const size of [15, 18]) for (const density of ['compact', 'comfortable', 'cozy']) for (const mode of ['light', 'dark'] as const) {
        await choose(`scale-${size}-${density}`, mode, `${size}px`, density)
        await check(`TC11-${host}-${size}-${density}-${mode}`, async () => {
          const value = await geometry(); samples.push({ host, size, density, mode, geometry: value })
          assert(value.icon.width / value.zoom >= 44 - .1 && value.icon.height / value.zoom >= 44 - .1, JSON.stringify(value.icon))
          assert(value.button.height / value.zoom >= 44 - .1); assert.equal(await page.getByTestId('loading').getAttribute('aria-busy'), 'true')
          assert(await page.getByTestId('loading').isDisabled()); assert(await page.getByTestId('disabled').isDisabled())
        })
      }
      await choose('reading', 'light')
      await check(`TC13-${host}-edges`, async () => { const value = await geometry(); assert(Math.abs(value.transcript.left - value.composer.left) <= 1); assert(Math.abs(value.transcript.right - value.composer.right) <= 1) })
      await check(`TC12-${host}-independent-scale`, async () => {
        try {
          const before = await geometry(); await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.2'))
          await settle()
          const ui = await geometry(); assert(ui.ui.fontSize >= before.ui.fontSize * 1.19); assert.equal(ui.reading.fontSize, before.reading.fontSize)
          await page.evaluate(() => document.documentElement.style.setProperty('--reading-scale', '1.3'))
          await settle()
          const reading = await geometry(); assert(reading.reading.fontSize >= ui.reading.fontSize * 1.29); assert.equal(reading.ui.fontSize, ui.ui.fontSize)
        } finally { await page.evaluate(() => { document.documentElement.style.removeProperty('--ui-scale'); document.documentElement.style.removeProperty('--reading-scale') }) }
      })
      for (const width of [320, 375, 390, 768, 769, 1280]) await check(`TC12-${host}-reflow-${width}`, async () => {
        await page.setViewportSize({ width, height: 1000 }); const value = await geometry(); samples.push({ host, width, geometry: value })
        assert(value.overflow <= 1, JSON.stringify(value)); await page.getByTestId('composer').scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(run.directory, `${host}-${width}.png`) })
      })
      await page.setViewportSize({ width: 390, height: 1000 })
      await check(`TC11-${host}-code-action`, async () => {
        const button = page.getByTestId('code').locator('button'); await button.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0)
        const sample = await button.evaluate(element => ({ opacity: getComputedStyle(element).opacity, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
        samples.push({ host, codeAction: sample }); assert.equal(sample.opacity, '1'); const zoom = (await geometry()).zoom; assert(sample.width / zoom >= 44 - .1 && sample.height / zoom >= 44 - .1)
      })
      await page.setViewportSize({ width: 1280, height: 1000 })
      for (const kind of ['popover', 'menu', 'fullscreen'] as const) await check(`TC15-${host}-${kind}-portal`, async () => {
        const parent = page.getByRole('dialog', { name: kind === 'fullscreen' ? '层级验收' : '主题对话框', exact: true })
        try {
          await page.reload({ waitUntil: 'networkidle' }); await page.locator('[data-roles-ready]').waitFor()
          await page.getByTestId(kind === 'fullscreen' ? 'fullscreen' : 'dialog').click()
          await parent.waitFor()
          await page.getByTestId(kind === 'popover' ? 'nested-popover' : `${kind === 'menu' ? 'nested' : 'fullscreen'}-menu`).click()
          const action = page.getByTestId(kind === 'popover' ? 'popover-action' : `${kind === 'menu' ? 'nested' : 'fullscreen'}-action`)
          await action.waitFor(); await choose(`portal-${kind}`, 'dark')
          assert(await action.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }), `${kind} must receive hits above its parent dialog`)
          await page.keyboard.press('Escape'); await action.waitFor({ state: 'detached' }); assert(await parent.isVisible())
          await page.keyboard.press('Escape'); await parent.waitFor({ state: 'detached' })
        } finally { await page.keyboard.press('Escape'); await page.keyboard.press('Escape') }
      })
      await check(`TC15-${host}-nested-portal`, async () => {
        await page.getByTestId('dialog').click(); await page.getByRole('dialog').waitFor()
        await page.getByTestId('nested-select').focus(); await page.keyboard.press('Space'); await page.getByRole('listbox').waitFor()
        await choose('portal-dark', 'dark')
        const option = page.getByRole('option', { name: '第二项' })
        assert(await option.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) }), 'Nested option must receive pointer hits above the dialog')
        await option.click()
        assert.equal(await page.getByTestId('nested-select').innerText(), '第二项')
        await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'nested-select')
        await page.keyboard.press('Space'); await page.getByRole('listbox').waitFor(); await page.keyboard.press('Escape')
        await page.getByRole('listbox').waitFor({ state: 'detached' })
        await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'nested-select')
        assert(await page.getByRole('dialog').isVisible()); assert(await page.getByTestId('nested-select').evaluate(element => document.activeElement === element))
        await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
        await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'dialog')
        assert(await page.getByTestId('dialog').evaluate(element => document.activeElement === element))
      })
    }
    await check('TC18-role-page-errors', async () => assert.deepEqual(errors, []))
  } finally {
    run.json('theme-roles.json', { checks, samples, errors, browser: launched.browser.version(), scope: 'Actual product components/CSS; synthetic account/session data and desktop Chromium touch emulation.' })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await server.close(); await launched.close()
  }
  run.complete(checks.filter(value => value.passed).map(value => value.id), ['Native packages', 'Physical touch devices and soft keyboard', '200% browser zoom and design comparison are separate acceptance scenes'])
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})

/** TC11–14: feature states, third-party adapters and authored-content isolation. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'
await verificationWorkflow('theme-domains', async run => {
  const root = resolve(import.meta.dir, '../..'), fixture = join(root, 'scripts/verification/fixtures/theme-roles.tsx')
  const sources = ['packages/ui/src/components/terminal/TerminalOutput.tsx', 'packages/ui/src/components/trajectory/trajectory-theme.css',
    'apps/electron/src/renderer/components/content-panels/session-decisions/DecisionBoard.tsx', 'apps/electron/src/renderer/components/pages/PageFrame.tsx',
    'apps/electron/src/renderer/components/content-panels/PdfFilePreview.tsx', 'scripts/verification/fixtures/theme-domains-content.tsx']
  run.json('source-hashes.json', Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])))
  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/scripts/verification/fixtures/theme-roles.tsx"></script>')
  writeFileSync(join(run.directory, 'host.css'), `@import "${relative(run.directory, join(root, 'apps/electron/src/renderer/index.css')).replaceAll('\\', '/')}";\n@source "${fixture.replaceAll('\\', '/')}";\n@source "${join(root, 'scripts/verification/fixtures/theme-domains-content.tsx').replaceAll('\\', '/')}";`)
  const launched = await launchWorkflowBrowser(), server = await createServer({ configFile: join(root, 'apps/electron/vite.config.ts'), root,
    optimizeDeps: { entries: [fixture], include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'], exclude: ['pdfjs-dist/build/pdf.worker.min.mjs?url'] }, server: { host: '127.0.0.1', port: 0, open: false } })
  await server.listen(); const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', hasTouch: true }), page = await context.newPage()
  const checks: { id: string; passed: boolean; error?: string }[] = [], samples: unknown[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  // Playwright's DOM snapshotter injects a script into every frame, including
  // static PageFrame's script-disabled srcdoc. Keep screenshot tracing without
  // that injection so Chromium's sandbox denial cannot pollute the error gate.
  await context.tracing.start({ screenshots: true, snapshots: false })
  async function check(id: string, fn: () => Promise<void>) { try { await fn(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) } }
  const choose = async (id: string, mode: 'light' | 'dark') => {
    await page.evaluate(({ id, mode }) => window.themeRoles.choose(id, mode), { id, mode })
    await page.waitForFunction(({ id, mode }) => (document.documentElement.dataset.theme ?? 'default') === id && document.documentElement.dataset.themeStatus === 'ready'
      && document.documentElement.classList.contains('dark') === (id === 'geek' || id === 'cyberpunk-2077' || mode === 'dark'), { id, mode })
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
  }
  try {
    run.json('preparation.json', await warmThemePage(context, `${base}${prefix}/index.html?domains=true&css=${encodeURIComponent(`${prefix}/host.css`)}`, '[data-domains-ready]'))
    await page.goto(`${base}${prefix}/index.html?domains=true&css=${encodeURIComponent(`${prefix}/host.css`)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('[data-domains-ready]').waitFor({ timeout: 120_000 }); await page.getByTestId('domain-mermaid').locator('svg').first().waitFor({ timeout: 120_000 })
    await page.getByTestId('domain-pdf').locator('canvas').waitFor({ timeout: 120_000 })
    const pdf = page.getByTestId('domain-pdf').locator('canvas'), frame = page.frameLocator('[data-testid="domain-pages"] iframe')
    await page.getByTestId('domain-pdf').locator('.react-pdf__Page__textContent').waitFor()
    const ansiBefore = await page.getByTestId('domain-terminal').locator('pre span').filter({ hasText: 'ANSI red' }).evaluate(element => getComputedStyle(element).color)
    for (const id of ['default', 'ink', 'geek', 'cyberpunk-2077']) for (const mode of ['light', 'dark'] as const) {
      await choose(id, mode)
      for (const state of ['ready', 'empty', 'loading', 'error'] as const) await check(`TC14-domains-${id}-${mode}-${state}`, async () => {
        await page.evaluate(state => window.themeDomains.setState(state), state)
        await page.waitForFunction(state => document.querySelector('[data-domains-ready]')?.getAttribute('data-domain-state') === state, state)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
        if (state === 'error') assert(await page.getByTestId('domain-decision').locator('button').count() > 0, 'Error state offers retry')
        const sample = await page.getByTestId('domain-decision').evaluate(element => ({ color: getComputedStyle(element).color, text: element.textContent?.slice(0, 300) }))
        samples.push({ id, mode, state, decision: sample })
        assert(sample.text?.length); assert.deepEqual(await page.evaluate(() => window.themeDomains.pdfErrors), [])
      })
      await check(`TC14-terminal-${id}-${mode}`, async () => {
        const value = await page.getByTestId('domain-terminal').locator('pre').evaluate(element => {
          const reference = document.createElement('span'); reference.style.color = 'var(--foreground)'; document.body.append(reference)
          const expected = getComputedStyle(reference).color, actual = getComputedStyle(element).color; reference.remove(); return { expected, actual }
        }); assert.equal(value.actual, value.expected)
        assert.equal(await page.getByTestId('domain-terminal').locator('pre span').filter({ hasText: 'ANSI red' }).evaluate(element => getComputedStyle(element).color), ansiBefore)
      })
      await check(`TC14-owned-content-${id}-${mode}`, async () => {
        assert.equal(await frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(44, 83, 100)')
        assert.equal(await page.getByTestId('domain-pages').locator('iframe').getAttribute('sandbox'), '', 'Static authored content must not allow scripts or same-origin access')
        const bitmap = await pdf.evaluate(canvas => {
          const element = canvas as HTMLCanvasElement, context = element.getContext('2d')!
          return { width: element.width, height: element.height, corner: Array.from(context.getImageData(0, 0, 1, 1).data), filter: getComputedStyle(element).filter }
        })
        samples.push({ id, mode, pdf: bitmap }); assert.deepEqual(bitmap.corner, [255, 255, 255, 255]); assert.equal(bitmap.filter, 'none')
        assert((await page.getByTestId('domain-pdf').locator('.react-pdf__Page__textContent').innerText()).includes('User-owned PDF'))
      })
    }
    await choose('ink', 'light'); await page.evaluate(() => window.themeDomains.setState('ready'))
    await check('TC11-domain-keyboard-row', async () => { await page.getByTestId('entity').focus(); await page.keyboard.press('Enter'); assert.equal(await page.getByTestId('entity').getAttribute('aria-selected'), 'true') })
    await check('TC11-domain-touch-copy', async () => {
      for (const button of await page.getByTestId('domain-terminal').locator('button').all()) {
        const box = await button.boundingBox(); assert(box && box.width >= 43.9 && box.height >= 43.9)
      }
    })
    for (const width of [320, 390, 768, 769, 1280]) await check(`TC12-domain-reflow-${width}`, async () => {
      await page.setViewportSize({ width, height: 900 }); await page.getByTestId('domain-decision').scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
      await page.screenshot({ path: join(run.directory, `domains-${width}.png`) })
    })
    await check('TC18-domain-errors', async () => assert.deepEqual(errors, []))
  } finally {
    run.json('theme-domains.json', { checks, samples, errors, browser: launched.browser.version(), trace: { screenshots: true, snapshots: false, reason: 'DOM snapshot injection is denied by the static PageFrame sandbox; all application console errors remain fatal.' }, scope: 'Real row, settings, kanban, decisions, trajectory, terminal, Mermaid, PDF and PageFrame; synthetic data; PDF/Pages content ownership is asserted.' })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await server.close(); await launched.close()
  }
  run.complete(checks.filter(value => value.passed).map(value => value.id), ['Live external provider and native materials', 'Physical mobile soft keyboard'])
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})

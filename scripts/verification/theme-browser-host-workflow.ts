/** TC09 / TC14: real standalone toolbar and empty-state entries. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildFixturePage } from './fixture-bundle'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'
await verificationWorkflow('theme-browser-host', async run => {
  const root = resolve(import.meta.dir, '../..')
  const sources = ['apps/electron/src/renderer/browser-toolbar.tsx', 'apps/electron/src/renderer/browser-empty-state.tsx',
    'apps/electron/src/preload/browser-toolbar.ts', 'apps/electron/src/main/browser-pane-manager.ts']
  run.json('source-hashes.json', Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])))
  const launched = await launchWorkflowBrowser(), server = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/theme-browser-host.ts' })
  const base = server.url
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' }), page = await context.newPage()
  const checks: { id: string; passed: boolean; error?: string }[] = [], samples: unknown[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await context.tracing.start({ screenshots: true, snapshots: true })
  async function check(id: string, fn: () => Promise<void>) { try { await fn(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) } }
  try {
    run.json('preparation.json', await warmThemePage(context, `${base}?host=toolbar`, '#root > *'))
    for (const host of ['toolbar', 'empty']) {
      await page.goto(`${base}?host=${host}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.locator('#root > *').first().waitFor({ timeout: 120_000 })
      for (const id of ['default', 'ink', 'geek', 'cyberpunk-2077']) for (const mode of ['light', 'dark'] as const) await check(`TC14-${host}-${id}-${mode}`, async () => {
        await page.evaluate(({ id, mode }) => window.themeBrowserHost.choose(id, mode), { id, mode })
        await page.waitForFunction(({ id }) => document.documentElement.dataset.theme === id && document.documentElement.dataset.themeStatus === 'ready', { id }, { timeout: 5000 })
        const sample = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          revision: document.documentElement.dataset.themeRevision, foreground: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor }))
        assert(sample.revision); assert.equal(sample.mode, id === 'geek' || id === 'cyberpunk-2077' ? 'dark' : mode); samples.push({ host, id, requestedMode: mode, ...sample })
        if (id === 'ink') await page.screenshot({ path: join(run.directory, `${host}-${mode}.png`) })
      })
      await check(`TC14-${host}-invalid-fallback`, async () => {
        await page.evaluate(() => window.themeBrowserHost.choose('invalid', 'light', { name: 'Invalid', background: 'banana' }))
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'default' && document.documentElement.dataset.themeStatus === 'error', null, { timeout: 5000 })
      })
      await check(`TC14-${host}-scenic-failure`, async () => {
        await page.evaluate(() => window.themeBrowserHost.choose('broken-image', 'dark', { name: 'Broken image', mode: 'scenic', backgroundImage: 'data:image/png;base64,broken' }))
        await page.waitForFunction(() => document.documentElement.dataset.themeStatus === 'error' && document.documentElement.dataset.theme === 'default', null, { timeout: 5000 })
        assert.equal(await page.evaluate(() => document.documentElement.style.backgroundImage), '')
      })
      await check(`TC14-${host}-repair`, async () => {
        await page.evaluate(() => window.themeBrowserHost.choose('ink', 'dark'))
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'ink' && document.documentElement.dataset.themeStatus === 'ready', null, { timeout: 5000 })
      })
    }
    await check('TC18-browser-host-errors', async () => assert.deepEqual(errors, []))
  } finally {
    run.json('theme-browser-host.json', { checks, samples, errors, browser: launched.browser.version(), scope: 'Real standalone renderer entries; IPC payload delivery is synthetic. Native delivery is verified separately.' })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await server.close(); await launched.close()
  }
  run.complete(checks.filter(value => value.passed).map(value => value.id), ['Native IPC delivery and OS materials are separate acceptance scenes'])
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})

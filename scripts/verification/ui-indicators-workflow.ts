import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer, type UserConfig, type PluginOption } from 'vite'
import rendererConfig from '../../apps/electron/vite.config'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'

async function fixturePlugins(plugins: PluginOption[]): Promise<PluginOption[]> {
  const result: PluginOption[] = []
  for (const value of plugins) {
    const plugin = await value
    if (Array.isArray(plugin)) result.push(...await fixturePlugins(plugin))
    else if (!plugin || plugin.name !== '@rolldown/plugin-babel') result.push(plugin)
  }
  return result
}

await verificationWorkflow('ui-indicators', async run => {
  const root = resolve(import.meta.dir, '../..')
  const prefix = '/' + run.directory.slice(root.length + 1).replaceAll('\\', '/')
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/ui-indicators.tsx"></script></body></html>')
  const config = rendererConfig as UserConfig
  const vite = await createServer({ ...config, configFile: false, plugins: await fixturePlugins(config.plugins ?? []), root,
    cacheDir: join(root, '.cache/vite-ui-indicators'), server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/.cache/**'] } },
    optimizeDeps: { ...config.optimizeDeps, entries: [join(root, 'scripts/verification/fixtures/ui-indicators.tsx')] } })
  await vite.listen()
  const browser = await launchWorkflowBrowser()
  const checks: string[] = [], errors: string[] = [], measurements: unknown[] = []
  try {
    const url = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}${prefix}/index.html`
    for (const scale of [1, 1.25, 1.5, 2]) {
      const context = await browser.browser.newContext({ viewport: { width: 680, height: 480 }, deviceScaleFactor: scale })
      try {
        if (scale === 1) run.json('preparation.json', await warmThemePage(context, url, 'h1'))
        await context.tracing.start({ screenshots: true, snapshots: true })
        const page = await context.newPage()
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
        await page.evaluate(() => document.fonts.ready)
        const pages = page.getByRole('button', { name: 'Pages', exact: true })
        for (const mode of ['expanded', 'collapsed']) {
          if (mode === 'collapsed') await page.getByRole('button', { name: 'Toggle sidebar' }).click()
          const icon = await pages.locator('svg').boundingBox()
          const peer = await page.getByRole('button', { name: 'Projects', exact: true }).locator('svg').boundingBox()
          assert(icon && peer && icon.width === peer.width && icon.height === peer.height)
          await pages.click()
          await page.locator('output').filter({ hasText: 'Pages selected' }).waitFor()
          await page.mouse.move(650, 450)
          await page.screenshot({ path: join(run.directory, `${scale}-${mode}.png`) })
          measurements.push({ scale, mode, icon, peer })
          checks.push(`${scale}-${mode}-pages-navigation`)
        }
        const sizes = await page.locator('[data-size] .spinner').evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect()
          return { size: element.parentElement!.dataset.size, width: rect.width, height: rect.height }
        }))
        const utilitySize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75)
        for (const box of sizes) {
          const expected = box.size === 'explicit' ? utilitySize : Number(box.size)
          assert.equal(box.width, expected)
          assert.equal(box.height, expected)
        }
        measurements.push({ scale, sizes })
        assert.equal(await page.getByRole('status', { name: 'Loading…', exact: true }).count(), 6)
        const ring = page.locator('[data-size="10"] svg')
        const rotation = await ring.evaluate(element => getComputedStyle(element).transform)
        await page.waitForTimeout(180)
        assert.notEqual(await ring.evaluate(element => getComputedStyle(element).transform), rotation)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        assert.equal(await ring.evaluate(element => getComputedStyle(element).animationName), 'none')
        assert(await ring.isVisible())
        await page.screenshot({ path: join(run.directory, `${scale}-reduced-motion.png`) })
        checks.push(`${scale}-loading-size-motion-accessibility`)
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await page.screenshot({ path: join(run.directory, `${scale}-dark.png`) })
        await context.tracing.stop({ path: join(run.directory, `${scale}-trace.zip`) })
      } finally { await context.close() }
    }
    assert.deepEqual(errors, [])
    run.json('ui-indicators.json', { checks, measurements, errors })
    run.complete(checks, ['Native installer typography is verified separately with the NSIS preview.', 'Live AI provider execution was not exercised.'])
  } finally { await browser.close(); await vite.close() }
})

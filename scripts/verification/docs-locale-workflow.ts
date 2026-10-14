import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer, type UserConfig, type PluginOption } from 'vite'
import rendererConfig from '../../apps/electron/vite.config'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'
import { DOCS_PAGES, findDocsPage } from '../../apps/electron/src/renderer/docs/manifest'

async function fixturePlugins(plugins: PluginOption[]): Promise<PluginOption[]> {
  const result: PluginOption[] = []
  for (const value of plugins) {
    const plugin = await value
    if (Array.isArray(plugin)) result.push(...await fixturePlugins(plugin))
    else if (!plugin || plugin.name !== '@rolldown/plugin-babel') result.push(plugin)
  }
  return result
}

await verificationWorkflow('docs-locale', async run => {
  const root = resolve(import.meta.dir, '../..'), prefix = '/' + run.directory.slice(root.length + 1).replaceAll('\\', '/')
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/docs-locale.tsx"></script></body></html>')
  const config = rendererConfig as UserConfig
  const plugins = await fixturePlugins(config.plugins ?? [])
  const vite = await createServer({ ...config, configFile: false, plugins, root, cacheDir: join(root, '.cache/vite-docs-locale'), server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/.cache/**'] } }, optimizeDeps: { ...config.optimizeDeps, entries: [join(root, 'scripts/verification/fixtures/docs-locale.tsx')] } }); await vite.listen()
  const browser = await launchWorkflowBrowser(), context = await browser.browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage()
  let tracing = false
  const checks: string[] = [], errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  try {
    const url = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}${prefix}/index.html`
    run.json('preparation.json', await warmThemePage(context, url, 'article h1'))
    await context.tracing.start({ screenshots: true, snapshots: true }); tracing = true
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.waitForFunction(() => Boolean((window as any).docsFixture))
    for (const entry of DOCS_PAGES) {
      await page.evaluate(slug => (window as any).docsFixture.open(slug), entry.slug)
      await page.locator('article').getByRole('heading', { level: 1, name: findDocsPage(entry.slug, 'zh-Hans')!.title, exact: true }).waitFor()
      assert(!/not written yet/i.test(await page.locator('article').innerText())); checks.push(`zh-page:${entry.slug}`)
    }
    await page.getByRole('searchbox').fill('权限'); await page.locator('nav button').first().waitFor(); assert(await page.locator('nav').innerText().then(text => /权限/.test(text))); checks.push('chinese-search-and-navigation')
    await page.getByRole('searchbox').fill(''); await page.evaluate(() => (window as any).docsFixture.open('go-further/tasks'))
    await page.locator('article').getByRole('heading', { level: 1, name: '任务', exact: true }).waitFor()
    await page.locator('article a').filter({ hasText: /^权限$/ }).first().click(); await page.locator('article h1').filter({ hasText: '权限' }).waitFor(); checks.push('internal-deep-link-retains-locale')
    const heading = await page.locator('article h1').boundingBox(); assert(heading && heading.y >= 48 && heading.y < 250, 'Internal navigation must reset to the page heading')
    await page.screenshot({ path: join(run.directory, 'docs-zh-desktop.png') })
    await page.evaluate(() => (window as any).docsFixture.language('en')); await page.locator('article h1').filter({ hasText: 'Permissions' }).waitFor(); checks.push('english-switch-preserves-slug')
    await page.evaluate(() => (window as any).docsFixture.language('zh-Hans')); await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('combobox').selectOption('go-further/document-tools'); await page.locator('article h1').filter({ hasText: '文档工具' }).waitFor()
    const search = await page.getByRole('searchbox').boundingBox(); assert(search && search.x > 215, 'Narrow search must clear the centered title')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0); await page.screenshot({ path: join(run.directory, 'docs-zh-390.png') }); checks.push('narrow-keyboard-navigation')
    await page.keyboard.press('Escape'); await page.getByRole('searchbox').waitFor({ state: 'hidden' }); checks.push('escape-closes-reader')
    assert.deepEqual(errors, []); run.json('docs-locale.json', { checks }); run.complete(checks, ['Browser reader and compiled content; external support sites and other locales were not added.'])
  } finally { run.json('browser-state.json', { body: await page.locator('body').innerText(), errors, checks }); await page.screenshot({ path: join(run.directory, 'browser-final.png') }).catch(() => {}); if (tracing) await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await browser.close(); await vite.close() }
})

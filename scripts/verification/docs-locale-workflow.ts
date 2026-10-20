import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'
import { DOCS_PAGES, findDocsPage } from '../../apps/electron/src/renderer/docs/manifest'

await verificationWorkflow('docs-locale', async run => {
  // Browser first, then a one-shot build served as plain files: a Vite dev server
  // in this process makes Chromium's launch and the page's module graph stall
  // (see the failure matrix entry for the browser harness).
  const browser = await launchWorkflowBrowser(), context = await browser.browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage()
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/docs-locale.tsx' })
  let tracing = false
  const checks: string[] = [], errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  try {
    const url = fixture.url
    await context.tracing.start({ screenshots: true, snapshots: true }); tracing = true
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForFunction(() => Boolean((window as any).docsFixture), undefined, { timeout: 60_000 })
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
  } finally { run.json('browser-state.json', { body: await page.locator('body').innerText(), errors, checks }); await page.screenshot({ path: join(run.directory, 'browser-final.png') }).catch(() => {}); if (tracing) await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await browser.close(); await fixture.close() }
})

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer, type PluginOption, type UserConfig } from 'vite'
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

await verificationWorkflow('markdown-file-links', async run => {
  const root = resolve(import.meta.dir, '../..'), prefix = '/' + run.directory.slice(root.length + 1).replaceAll('\\', '/')
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/markdown-file-links.tsx"></script></body></html>')
  const config = rendererConfig as UserConfig
  const vite = await createServer({ ...config, configFile: false, root, plugins: await fixturePlugins(config.plugins ?? []), cacheDir: join(root, '.cache/vite-markdown-file-links'), server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/.cache/**'] } }, optimizeDeps: { ...config.optimizeDeps, entries: [join(root, 'scripts/verification/fixtures/markdown-file-links.tsx')] } }); await vite.listen()
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext(), page = await context.newPage()
  const checks: string[] = [], errors: string[] = [], details: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  let tracing = false
  try {
    const url = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}${prefix}/index.html`
    run.json('preparation.json', await warmThemePage(context, url, 'main a'))
    await context.tracing.start({ screenshots: true, snapshots: true }); tracing = true
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.waitForFunction(() => window.fileLinkFixture?.ready)
    const cases = [
      ['windows-backslash', '[open](E:\\Phaneris\\docs\\report.md)', 'E:\\Phaneris\\docs\\report.md'],
      ['windows-dot-directory', '[open](<E:\\Phaneris\\.cache\\report.md>)', 'E:\\Phaneris\\.cache\\report.md'],
      ['windows-punctuation-directory', '[open](<E:\\Phaneris\\_notes\\report.md>)', 'E:\\Phaneris\\_notes\\report.md'],
      ['windows-reference', '[open][report]\n\n[report]: <E:\\Phaneris\\.cache\\report.md>', 'E:\\Phaneris\\.cache\\report.md'],
      ['windows-encoded-backslash', '[open](E:%5CPhaneris%5Cdocs%5Creport.md)', 'E:\\Phaneris\\docs\\report.md'],
      ['windows-forward-slash', '[open](E:/Phaneris/docs/report.md)', 'E:/Phaneris/docs/report.md'],
      ['windows-unicode-space', '[open](<E:\\项目\\季度 报告.txt>)', 'E:\\项目\\季度 报告.txt'],
      ['file-url', '[open](file:///E:/%E9%A1%B9%E7%9B%AE/%E6%8A%A5%E5%91%8A%20final.pdf)', 'E:/项目/报告 final.pdf'],
      ['literal-percent', '[open](file:///E:/report%2520literal.txt)', 'E:/report%20literal.txt'],
      ['relative-unicode', '[open](./%E8%BE%93%E5%87%BA/%E6%8A%A5%E5%91%8A.md)', './输出/报告.md'],
      ['source-location', '[open](E:/Phaneris/src/main.ts:120:7)', 'E:/Phaneris/src/main.ts'],
      ['unix-root', '[open](/tmp/report.md)', '/tmp/report.md'],
      ['raw-html-file', '<a href="file:///E:/report.txt">open</a>', 'E:/report.txt'],
    ] as const
    for (const [id, markdown, expected] of cases) {
      await page.evaluate(content => { window.fileLinkFixture.files = []; window.fileLinkFixture.urls = []; window.fileLinkFixture.setContent(content) }, markdown)
      const link = page.getByRole('link', { name: 'open', exact: true })
      await link.waitFor({ timeout: 10_000 }); await link.click()
      const actual = await page.evaluate(() => ({ files: window.fileLinkFixture.files, urls: window.fileLinkFixture.urls }))
      details.push({ id, expected, actual }); assert.deepEqual(actual, { files: [expected], urls: [] }, id)
      assert.equal(await link.getAttribute('href'), '#'); checks.push(id)
    }
    for (const activation of ['keyboard', 'middle-click'] as const) {
      await page.evaluate(() => { window.fileLinkFixture.files = []; window.fileLinkFixture.setContent('[activate](file:///E:/report.txt)') })
      const link = page.getByRole('link', { name: 'activate', exact: true }); await link.waitFor()
      if (activation === 'keyboard') { await link.focus(); await page.keyboard.press('Enter') } else await link.click({ button: 'middle' })
      assert.deepEqual(await page.evaluate(() => window.fileLinkFixture.files), ['E:/report.txt']); checks.push(activation)
    }
    await page.evaluate(() => { window.fileLinkFixture.urls = []; window.fileLinkFixture.setContent('[web](https://example.com/report.pdf)') })
    await page.getByRole('link', { name: 'web', exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.fileLinkFixture.urls), ['https://example.com/report.pdf']); checks.push('web-links-preserved')
    await page.evaluate(() => { window.fileLinkFixture.files = []; window.fileLinkFixture.setContent('<a href="javascript:alert(1)" data-phaneris-file-path="E:/spoof.txt" onclick="window.__unsafe=true">blocked</a><script>window.__unsafe=true</script>') })
    const blocked = page.getByText('blocked', { exact: true }); await blocked.click()
    assert.deepEqual(await page.evaluate(() => window.fileLinkFixture.files), [])
    assert.equal(await blocked.getAttribute('href'), null)
    assert.equal(await page.locator('main script, main [onclick]').count(), 0); checks.push('dangerous-html-and-spoofed-target-sanitized')
    await page.evaluate(() => window.fileLinkFixture.setContent('<details><summary>More</summary><p class="retained">Safe content</p></details>'))
    await page.locator('summary').click(); await page.getByText('Safe content', { exact: true }).waitFor(); checks.push('safe-html-formatting-preserved')
    assert.deepEqual(errors, []); run.json('markdown-file-links.json', { checks, details }); await page.screenshot({ path: join(run.directory, 'file-links.png') }); run.complete(checks, ['Callback routing uses the actual shared Markdown component. Native production workflow separately verifies real file loading.'])
  } finally { run.json('browser-state.json', { checks, details, errors, body: await page.locator('body').innerText() }); if (tracing) await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await launched.close(); await vite.close() }
})

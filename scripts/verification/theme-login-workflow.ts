/** TC11 / TC14: the unauthenticated entry owns Default/system, no saved user config. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'
await verificationWorkflow('theme-login', async run => {
  const root = resolve(import.meta.dir, '../..'), source = 'apps/webui/src/login.html'
  run.json('source-hashes.json', { [source]: createHash('sha256').update(readFileSync(join(root, source))).digest('hex') })
  const launched = await launchWorkflowBrowser(), server = await createServer({ configFile: join(root, 'apps/electron/vite.config.ts'), root,
    server: { host: '127.0.0.1', port: 0, open: false } })
  await server.listen(); const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  const context = await launched.browser.newContext({ viewport: { width: 390, height: 820 }, reducedMotion: 'reduce', hasTouch: true }), page = await context.newPage()
  const checks: { id: string; passed: boolean; error?: string }[] = [], samples: unknown[] = [], errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()))
  await page.route('**/api/auth', route => route.fulfill({ status: 401, json: { error: 'Authentication failed' } }))
  for (const name of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) await page.route(`**/${name}`, route => route.fulfill({ path: join(root, 'apps/webui/src/public', name) }))
  await context.tracing.start({ screenshots: true, snapshots: true })
  async function check(id: string, fn: () => Promise<void>) { try { await fn(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) } }
  try {
    for (const mode of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: mode })
      await gotoWithRetry(page, `${base}/apps/webui/src/login.html`)
      await check(`TC14-login-${mode}`, async () => {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.themeHostPolicy), 'unauth-default-system')
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), mode === 'dark')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
        const box = await page.getByRole('button', { name: 'Sign In', exact: true }).boundingBox(); assert(box && box.height >= 43.9)
      })
      await check(`TC11-login-${mode}-focus-error`, async () => {
        await page.getByLabel('Server Token').fill('isolated-fixture-token')
        await page.keyboard.press('Tab')
        const focus = await page.getByRole('button', { name: 'Sign In', exact: true }).evaluate(element => ({ visible: element.matches(':focus-visible'), outline: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }))
        samples.push({ mode, focus }); assert(focus.visible && focus.outline !== 'none' && parseFloat(focus.width) >= 2)
        await page.keyboard.press('Enter'); await page.locator('#error.visible').waitFor()
        assert.equal(await page.locator('#error').getAttribute('role'), 'alert'); assert(await page.getByRole('button', { name: 'Sign In', exact: true }).isEnabled())
        await page.screenshot({ path: join(run.directory, `login-${mode}.png`) })
      })
    }
    await check('TC18-login-errors-and-fonts', async () => { assert.deepEqual(errors, []); assert(!requests.some(url => /fonts\.google|fonts\.gstatic/.test(url))) })
  } finally {
    run.json('theme-login.json', { checks, samples, errors, browser: launched.browser.version(), scope: 'Real login HTML/CSS; auth rejection is synthetic; credentials are isolated fixture strings.' })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await server.close(); await launched.close()
  }
  run.complete(checks.filter(value => value.passed).map(value => value.id), ['Real server auth lifecycle is covered by webui-auth-lifecycle'])
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})

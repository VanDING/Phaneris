/** Run: bun scripts/verification/verify-upstream-residuals.ts
 * Browser integration through real UI and callback HTTP server. IPC is a fixture;
 * this does not log in to a provider or execute an LLM task.
 * Artifacts: .cache/verification/upstream-residuals/{report.json,*.png}
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strict as assert } from 'node:assert'
import { createCallbackServer } from '../../packages/shared/src/auth/callback-server'

const root = resolve(import.meta.dir, '../..')
const out = resolve(root, '.cache/verification/upstream-residuals')
await mkdir(out, { recursive: true })
const server = await createServer({
  configFile: resolve(root, 'apps/electron/vite.config.ts'), root,
  optimizeDeps: { entries: ['scripts/verification/upstream-residuals.html'] },
  server: { host: '127.0.0.1', port: 5188, strictPort: true, open: false },
})
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
page.setDefaultTimeout(120_000)
const errors: string[] = []
page.on('pageerror', error => errors.push(error.message))
const url = 'http://127.0.0.1:5188/scripts/verification/upstream-residuals.html'
try {
  await page.goto(`${url}?empty`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Connect an AI provider to select a model').waitFor()
  assert(await page.getByRole('button', { name: 'Create & Run', exact: true }).isDisabled())
  await page.getByRole('button', { name: 'Load connections' }).click()
  await page.getByRole('button', { name: 'MiniMax-M3', exact: true }).waitFor()
  assert(await page.getByRole('button', { name: 'Create & Run', exact: true }).isEnabled())
  const chips = page.getByTestId('chips')
  assert(!/pi\//i.test(await chips.innerText()))
  const icons = await chips.locator('img').evaluateAll(elements => elements.map(el => el.getAttribute('src')))
  assert.deepEqual(icons, await page.evaluate(() => (window as any).expectedIcons))
  await page.getByPlaceholder('Name this task…').fill('Verified task')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await page.getByPlaceholder('Subtask title…').waitFor()
  await page.screenshot({ path: resolve(out, 'task-editor.png'), fullPage: true })
  await page.getByRole('button', { name: 'Create & Run', exact: true }).click()
  await page.waitForFunction(() => (window as any).verificationCalls.some((call: any) => call.action === 'run'))
  const calls = await page.evaluate(() => (window as any).verificationCalls)
  const generation = calls.find((call: any) => call.action === 'generate')
  assert.equal(generation.input.model, 'pi/MiniMax-M3')
  assert.equal(generation.input.llmConnection, 'minimax')
  const spec = JSON.parse(calls.find((call: any) => call.action === 'create').input.yaml)
  assert.equal(spec.defaults.model, 'pi/MiniMax-M3')
  assert.equal(spec.defaults.llmConnection, 'minimax')
  assert.equal(spec.nodes[0].model, undefined)

  const callback = await createCallbackServer()
  try {
    const response = await page.goto(`${callback.url}/callback?code=fixture-code&state=fixture-state`)
    assert.equal(response?.status(), 200)
    assert.equal((await callback.promise).query.code, 'fixture-code')
    assert((await page.title()).startsWith('Phaneris - '))
    assert(!/Craft|████/.test(await page.locator('body').innerText()))
    await page.screenshot({ path: resolve(out, 'oauth-callback.png') })
  } finally { await callback.close() }
  assert.deepEqual(errors, [])
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ passed: true, date: new Date().toISOString(), icons, calls, errors }, null, 2))
  console.log(`PASS: browser regression artifacts at ${out}`)
} catch (error) {
  await page.screenshot({ path: resolve(out, 'failure.png'), timeout: 5000 }).catch(() => {})
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.stack : String(error), errors, body: await page.locator('body').innerText({ timeout: 5000 }).catch(() => '') }, null, 2))
  throw error
} finally {
  await browser.close()
  await server.close()
}

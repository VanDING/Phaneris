/** Browser workflow verification; run: bun scripts/verification/verify-upstream-0140-ui.ts
 * Uses real permission/dialog components, replayed IPC, and headless Edge.
 * Records screenshots and a report under docs/verification/results/upstream-0.14.0-ui/.
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strict as assert } from 'node:assert'

const root = resolve(import.meta.dir, '../..')
const out = resolve(root, 'docs/verification/results/upstream-0.14.0-ui')
await mkdir(out, { recursive: true })
const server = await createServer({
  configFile: resolve(root, 'apps/electron/vite.config.ts'), root,
  optimizeDeps: { entries: ['scripts/verification/upstream-0140-ui.html'] },
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
})
await server.listen()
const address = server.httpServer!.address()
if (!address || typeof address === 'string') throw new Error('No loopback HTTP port')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1100, height: 800 } })
const page = await context.newPage()
page.setDefaultTimeout(60_000)
const errors: string[] = []
const checks: string[] = []
page.on('pageerror', error => errors.push(error.message))
const setMode = (value: string) => page.evaluate(value => (window as any).setFixtureRtk(value), value)
try {
  await page.goto(`http://127.0.0.1:${address.port}/scripts/verification/upstream-0140-ui.html`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const permission = page.getByTestId('permission')
  await permission.getByRole('button', { name: 'Allow', exact: true }).waitFor()
  assert.equal(await permission.getByRole('button', { name: 'Always Allow', exact: true }).count(), 0)
  await permission.getByRole('button', { name: 'Deny', exact: true }).click()
  await page.screenshot({ path: resolve(out, 'permission-limited.png') })
  checks.push('Dangerous command has Allow and Deny, without Always Allow')
  await page.getByRole('button', { name: 'Switch scope' }).click()
  await permission.getByRole('button', { name: 'Always Allow', exact: true }).click()
  const responses = await page.evaluate(() => (window as any).verificationCalls.filter((entry: any) => entry.action === 'permission'))
  assert.deepEqual(responses.map((entry: any) => entry.response), [{ type: 'permission', allowed: false, alwaysAllow: false }, { type: 'permission', allowed: true, alwaysAllow: true }])
  checks.push('Scoped approval sends the explicit remember answer')
  await page.getByRole('button', { name: 'Update RTK' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert((await dialog.innerText()).includes('0.44.0'))
  await dialog.getByRole('button', { name: 'Copy command', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'winget install --id rtk-ai.rtk --exact')
  checks.push('Windows update command is copied without execution')
  await dialog.getByRole('button', { name: 'Re-check', exact: true }).click()
  assert(await dialog.isVisible())
  await setMode('missing')
  await dialog.getByRole('button', { name: 'Re-check', exact: true }).click()
  assert(await dialog.isVisible())
  await setMode('error')
  await dialog.getByRole('button', { name: 'Re-check', exact: true }).click()
  await page.getByText('Could not re-check RTK. Try again.', { exact: true }).waitFor()
  assert(await dialog.getByRole('button', { name: 'Re-check', exact: true }).isEnabled())
  checks.push('Outdated, missing, and failed re-checks keep the dialog available')
  await page.screenshot({ path: resolve(out, 'rtk-outdated.png') })
  await setMode('updated')
  await dialog.getByRole('button', { name: 'Re-check', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  checks.push('Usable RTK closes the dialog after a forced re-check')
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await page.getByRole('button', { name: 'Update RTK' }).click()
  await dialog.waitFor()
  const chinese = JSON.parse(await readFile(resolve(root, 'packages/shared/src/i18n/locales/zh-Hans.json'), 'utf8'))
  await dialog.getByText(chinese['rtkUpdate.title'], { exact: true }).waitFor()
  assert(!(await dialog.innerText()).includes('rtkUpdate.'))
  assert((await dialog.innerText()).includes('0.44.0'))
  await page.screenshot({ path: resolve(out, 'rtk-zh-Hans.png') })
  checks.push('Chinese translations render without unresolved keys')
  await dialog.getByRole('button', { name: chinese['rtkUpdate.later'], exact: true }).click()
  await setMode('old')
  await page.getByRole('button', { name: 'Toggle automatic prompt' }).click()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: chinese['rtkUpdate.later'], exact: true }).click()
  await page.waitForFunction(() => (window as any).verificationPreferences?.rtkUpdateDismissedVersion === '0.43.0')
  const preserved = await page.evaluate(() => (window as any).verificationPreferences)
  assert.equal(preserved.name, 'Fixture user')
  assert.equal(preserved.diffViewer.diffStyle, 'split')
  await page.getByRole('button', { name: 'Toggle automatic prompt' }).click()
  const readsBefore = await page.evaluate(() => (window as any).verificationCalls.filter((entry: any) => entry.action === 'preferences-read').length)
  await page.getByRole('button', { name: 'Toggle automatic prompt' }).click()
  await page.waitForFunction(reads => (window as any).verificationCalls.filter((entry: any) => entry.action === 'preferences-read').length > reads, readsBefore)
  assert.equal(await dialog.count(), 0)
  checks.push('Dismissed RTK version uses native preferences, preserves other fields, and stays dismissed on remount')
  assert.deepEqual(errors, [])
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ passed: true, executedAt: new Date().toISOString(), checks, responses, calls: await page.evaluate(() => (window as any).verificationCalls), errors }, null, 2))
  console.log(`PASS: ${checks.length} browser workflows; ${out}`)
} catch (error) {
  await page.screenshot({ path: resolve(out, 'failure.png'), timeout: 5000 }).catch(() => {})
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ passed: false, error: error instanceof Error ? error.stack : String(error), errors }, null, 2))
  throw error
} finally {
  await browser.close()
  await server.close()
}

/** Real production UI rendered in headless Edge; emits screenshots and a workflow report. */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strict as assert } from 'node:assert'
import en from '../../packages/shared/src/i18n/locales/en.json'
const root = resolve(import.meta.dir, '../..'), out = resolve(root, 'docs/verification/results/upstream-0.14.0-b4-b5-ui')
await mkdir(out, { recursive: true })
const server = await createServer({ configFile: resolve(root, 'apps/electron/vite.config.ts'), root,
  optimizeDeps: { entries: ['scripts/verification/upstream-0140-b4b5-ui.html'] },
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, watch: { ignored: ['**/release/**', '**/dist/**', '**/.cache/**'] } } })
await server.listen()
const address = server.httpServer!.address()
if (!address || typeof address === 'string') throw Error('Missing loopback port')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.setDefaultTimeout(60_000)
const checks: string[] = [], errors: string[] = []
const diagnostics: string[] = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) })
page.on('requestfailed', request => diagnostics.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`))
page.on('response', response => { if (response.status() >= 400) diagnostics.push(`${response.status()} ${response.url()}`) })
async function capture(path: string) {
  await page.evaluate(() => {
    for (const element of [document.documentElement, document.body, document.getElementById('root')!]) {
      element.style.height = 'auto'
      element.style.overflow = 'visible'
      element.scrollTop = 0
    }
    const settings = document.querySelector<HTMLElement>('[data-testid="settings"]')!
    const viewport = settings.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')!
    settings.style.height = `${viewport.scrollHeight + 70}px`
    viewport.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await page.screenshot({ path, fullPage: true })
}
try {
  await page.goto(`http://127.0.0.1:${address.port}/scripts/verification/upstream-0140-b4b5-ui.html`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const permission = page.getByTestId('risks')
  await permission.getByText('Publishes', { exact: true }).waitFor()
  assert.equal(await permission.getByRole('button', { name: 'Always Allow', exact: true }).count(), 0)
  await permission.getByRole('button', { name: 'Allow', exact: true }).click()
  checks.push('Risk badges render while Guarded keeps a one-time approval without Always Allow')
  await page.getByTestId('modes').getByRole('button').click()
  assert.equal(await page.getByRole('button', { name: /Guarded.*Automatic/ }).count(), 0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Enable Guarded availability' }).click()
  await page.getByTestId('modes').getByRole('button').click()
  await page.getByRole('button', { name: /Guarded.*Automatic/ }).click()
  checks.push('Guarded is offered after availability changes and selection propagates to the session callback')
  await page.getByRole('button', { name: 'Approve fixture plan', exact: true }).click()
  await page.waitForFunction(() => (window as any).verificationCalls.some((call: any) => call.action === 'plan-submit'))
  await page.getByRole('button', { name: 'Approve fixture plan with compact', exact: true }).click()
  await page.waitForFunction(() => (window as any).verificationCalls.some((call: any) => call.action === 'plan-submit' && call.text === '/compact'))
  const planModes = await page.evaluate(() => (window as any).verificationCalls.filter((call: any) => call.action === 'plan-mode').map((call: any) => call.value))
  assert.deepEqual(planModes, ['guarded', 'guarded'])
  checks.push('Both production plan approval handlers return Explore to its previous Guarded mode')
  const advanced = page.getByRole('button', { name: /Advanced settings/ })
  await advanced.click()
  const featureKeys = ['DecideTool', 'Suggestions', 'AdaptiveThinking', 'LargeResults', 'MidTurnMessages', 'TurnOutcome', 'SmartTitles', 'GuardedMode', 'RiskBadges', 'SemanticLabels', 'AutomationConditions', 'TaskVerdicts', 'TaskRepairs']
  const featureLabels = featureKeys.map(key => en[`settings.ai.decisions.feature${key}` as keyof typeof en])
  for (const label of featureLabels) {
    const row = page.getByTestId('settings').locator('[data-layout="settings-row"]').filter({ has: page.getByText(label, { exact: true }) })
    assert.equal(await row.getByRole('switch').count(), 1, `Missing feature switch: ${label}`)
  }
  const guarded = page.getByTestId('settings').getByText('Guarded mode', { exact: true })
  await guarded.click()
  await page.waitForFunction(() => (window as any).verificationCalls.some((call: any) => call.patch?.features?.guardedMode === true))
  checks.push('Advanced settings exposes all 13 feature switches and persists Guarded independently')
  await capture(resolve(out, 'settings-en.png'))
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await page.waitForTimeout(100)
  const body = await page.locator('body').innerText()
  assert(!body.includes('settings.ai.decisions.'))
  assert(!body.includes('chat.permissionRisk'))
  await capture(resolve(out, 'settings-zh-Hans.png'))
  checks.push('Chinese feature and risk labels render without unresolved translation keys')
  assert.deepEqual(errors, [])
  checks.push('Production components finish without browser exceptions')
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ executedAt: new Date().toISOString(), browser: 'headless Edge', checks, errors,
    calls: await page.evaluate(() => (window as any).verificationCalls), advertisedFeatures: featureLabels }, null, 2) + '\n')
  console.log(`${checks.length} UI checks passed; ${out}`)
} catch (error) {
  await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true })
  console.error('Browser exceptions:', errors)
  console.error('Browser diagnostics:', diagnostics)
  throw error
} finally { await browser.close(); await server.close() }

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildFixturePage } from './fixture-bundle'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'

interface Controls {
  reads: string[]; reconnect(): void; release(): void; setWorkspace(id: string): void; setMounted(value: boolean): void
}
declare global { interface Window { statusStartup: Controls } }

await verificationWorkflow('status-startup', async run => {
  const bundle = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/status-startup.tsx' })
  const launched = await launchWorkflowBrowser(), page = await launched.browser.newPage()
  const checks: string[] = [], samples: unknown[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.context().tracing.start({ screenshots: true, snapshots: true })
  try {
    for (const scenario of ['healthy', 'transient', 'missing', 'persistent', 'reconnect', 'failed-reconnect', 'stale-workspace', 'unmount', 'statuses-transient', 'statuses-reconnect']) {
      await page.goto(`${bundle.url}?scenario=${scenario}`)
      const paths = page.locator('[data-testid="status"] svg path')
      if (scenario === 'reconnect') {
        await page.waitForFunction(() => window.statusStartup.reads.some(path => path.endsWith('.svg')))
        await page.evaluate(() => window.statusStartup.reconnect())
      } else if (scenario === 'persistent' || scenario === 'failed-reconnect') {
        await page.locator('[data-icon-state="error"]').waitFor()
        const attempts = await page.evaluate(() => window.statusStartup.reads.filter(path => path.endsWith('.svg')).length)
        assert.equal(attempts, 2, 'one bounded retry, shared across StrictMode mounts')
        if (scenario === 'failed-reconnect') await page.evaluate(() => window.statusStartup.reconnect())
      } else if (scenario === 'stale-workspace' || scenario === 'unmount') {
        await page.waitForFunction(() => window.statusStartup.reads.some(path => path.endsWith('.svg')))
        if (scenario === 'stale-workspace') {
          await page.evaluate(() => window.statusStartup.setWorkspace('second'))
          await page.locator('svg[data-workspace="second"]').waitFor()
          await page.evaluate(() => window.statusStartup.release())
        } else {
          await page.evaluate(() => window.statusStartup.setMounted(false))
          await page.locator('[data-testid="status"]').waitFor({ state: 'detached' })
          await page.evaluate(() => window.statusStartup.release())
          await page.waitForTimeout(100)
          await page.evaluate(() => window.statusStartup.setMounted(true))
        }
      } else if (scenario === 'statuses-reconnect') {
        await page.locator('[data-testid="configuration"][data-error="true"]').waitFor({ state: 'attached' })
        const before = await page.evaluate(() => window.statusStartup.reads.length)
        await page.waitForTimeout(1600)
        assert.equal(await page.evaluate(() => window.statusStartup.reads.length), before)
        await page.evaluate(() => window.statusStartup.reconnect())
      }
      if (scenario.startsWith('statuses-')) await page.getByText('Completed', { exact: true }).waitFor()
      else if (scenario === 'missing') await page.locator('[data-testid="status"] svg').waitFor()
      else if (scenario !== 'persistent') await paths.waitFor({ timeout: 5000 })
      const reads = () => page.evaluate(() => window.statusStartup.reads.length)
      const before = await reads(); await page.waitForTimeout(1600)
      assert.equal(await reads(), before, `${scenario}: no polling after a settled result`)
      assert.equal(await paths.count(), scenario === 'missing' || scenario === 'persistent' || scenario.startsWith('statuses-') ? 0 : 1)
      if (scenario === 'stale-workspace') assert.equal(await page.locator('svg[data-workspace="fixture"]').count(), 0)
      samples.push({ scenario, reads: before })
      await page.screenshot({ path: join(run.directory, `${scenario}.png`) })
      checks.push(`${scenario}: first-mounted-status-settles-without-navigation-or-polling`)
    }
    assert.deepEqual(errors, [])
    run.json('status-startup.json', { samples, errors })
    run.complete(checks, ['Actual Electron first paint is verified separately'])
    console.log(JSON.stringify({ passed: checks.length, output: run.directory }))
  } finally { await page.context().tracing.stop({ path: join(run.directory, 'trace.zip') }); await launched.close(); await bundle.close() }
})

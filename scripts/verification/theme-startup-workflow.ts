/** Browser race contract complements real Electron frame-by-frame startup evidence. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildFixturePage } from './fixture-bundle'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('theme-startup', async run => {
  const server = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/theme-startup.tsx' })
  const launched = await launchWorkflowBrowser()
  const context = await launched.browser.newContext(), page = await context.newPage()
  context.setDefaultTimeout(30_000)
  context.setDefaultNavigationTimeout(120_000)
  const checks: string[] = [], samples: unknown[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    for (const scenario of ['preferences', 'workspace', 'workspace-event', 'preferences-error', 'theme-error', 'preview']) {
      await page.goto(`${server.url}?scenario=${scenario}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const state = page.locator('output[data-startup-ready]'); await state.waitFor()
      if (scenario !== 'preview') {
        assert.equal(await state.getAttribute('data-startup-ready'), 'false'); checks.push(`${scenario}: cached Default is not reveal-ready`)
        await page.evaluate(() => window.themeStartup.release())
      }
      await page.waitForFunction(() => document.querySelector('output')?.getAttribute('data-startup-ready') === 'true')
      if (scenario === 'workspace-event') await page.waitForTimeout(350)
      const actual = await page.evaluate(() => ({ font: getComputedStyle(document.documentElement).fontSize, state: document.querySelector('output')!.textContent,
        applied: document.querySelector('output')!.getAttribute('data-applied'), status: document.querySelector('output')!.getAttribute('data-status') }))
      const expected = scenario === 'preferences' ? ['small', '13px', 'ready'] : scenario.startsWith('workspace') ? ['workspace-small', '14px', 'ready']
        : scenario === 'theme-error' ? ['default', '15px', 'error'] : ['default', '15px', 'ready']
      assert.deepEqual([actual.applied, actual.font, actual.status], expected)
      samples.push({ scenario, actual }); checks.push(`${scenario}: final or fallback snapshot can reveal`)
    }
    assert.deepEqual(errors, []); checks.push('startup compiler has no page errors')
    run.json('theme-startup.json', { checks, samples, errors, scope: 'Production ThemeProvider/compiler/CSS with synthetic delayed API; native App visibility is separately verified by shell-visual.' })
    run.complete(checks, ['Physical fonts/network variability outside this browser run'])
  } finally { await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await launched.close(); await server.close() }
})

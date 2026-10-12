/** Browser race contract complements real Electron frame-by-frame startup evidence. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('theme-startup', async run => {
  const root = resolve(import.meta.dir, '../..'), fixture = join(root, 'scripts/verification/fixtures/theme-startup.tsx')
  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/scripts/verification/fixtures/theme-startup.tsx"></script>')
  writeFileSync(join(run.directory, 'host.css'), `@import "${relative(run.directory, join(root, 'apps/electron/src/renderer/index.css')).replaceAll('\\', '/')}";`)
  const server = await createServer({ configFile: join(root, 'apps/electron/vite.config.ts'), root,
    optimizeDeps: { entries: [fixture], include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0, open: false } })
  const launched = await launchWorkflowBrowser()
  await server.listen()
  const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  const context = await launched.browser.newContext(), page = await context.newPage()
  const checks: string[] = [], samples: unknown[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    for (const scenario of ['preferences', 'workspace', 'workspace-event', 'preferences-error', 'theme-error', 'preview']) {
      await page.goto(`${base}${prefix}/index.html?css=${encodeURIComponent(`${prefix}/host.css`)}&scenario=${scenario}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const state = page.locator('output[data-startup-ready]'); await state.waitFor()
      if (scenario !== 'preview') {
        assert.equal(await state.getAttribute('data-startup-ready'), 'false'); checks.push(`${scenario}: cached Default is not reveal-ready`)
      }
      await page.waitForFunction(() => document.querySelector('output')?.getAttribute('data-startup-ready') === 'true')
      if (scenario === 'workspace-event') await page.waitForTimeout(2800)
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

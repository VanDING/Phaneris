import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { startProcess, testSecret } from './fixtures/governance-process-support'

// Fixed before changing navigation: a click while resident identity is loading
// must survive initial restore. Last explicit intent wins; deep links and the
// bare-startup default must continue working, with no paid model execution.
await verificationWorkflow('navigation-startup', async run => {
  const root = resolve(import.meta.dir, '../..'), config = join(run.directory, 'config'); mkdirSync(config)
  if (process.env.PHANERIS_NAVIGATION_SKIP_BUILD !== '1') {
    const build = Bun.spawn([process.execPath, 'run', 'webui:build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
    writeFileSync(join(run.directory, 'build.log'), stdout + stderr); assert.equal(code, 0)
  }
  const dist = join(root, 'apps/webui/dist')
  run.json('build-hashes.json', Object.fromEntries(readdirSync(dist, { recursive: true, encoding: 'utf8' }).map(String).filter(file => /\.(js|css|html|wasm)$/.test(file)).map(file => [file.replaceAll('\\', '/'), createHash('sha256').update(readFileSync(join(dist, file))).digest('hex')])))
  const child = await startProcess({ config, entry: join(import.meta.dir, 'fixtures/planning-performance-server.ts'), extra: { PHANERIS_C02_SIZE: '4', PHANERIS_NAVIGATION_UI: '1' } })
  const launched = await launchWorkflowBrowser(), base = child.url.replace(/^ws/, 'http')
  const checks: string[] = [], failures: unknown[] = [], errors: string[] = []
  const control = async (command: string) => {
    const response = await fetch(base + '/__planning', { method: 'POST', headers: { authorization: `Bearer ${testSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ command }), signal: AbortSignal.timeout(10_000) })
    assert(response.ok); return response.json() as Promise<{ residentBlocked: number }>
  }
  try {
    for (const id of ['delayed-project-click', 'last-explicit-navigation-wins', 'project-deep-link', 'bare-default-resident']) {
      const context = await launched.browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' })
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
      try {
        await control('hold-resident')
        await context.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
        assert((await context.request.post(base + '/api/auth', { data: { password: testSecret } })).ok())
        await gotoWithRetry(page, base + (id === 'project-deep-link' ? '/?route=projects' : '/'))
        await page.getByTestId('app-splash').waitFor({ state: 'hidden', timeout: 30_000 })
        const until = Date.now() + 10_000
        while (!(await control('metrics')).residentBlocked) { assert(Date.now() < until); await Bun.sleep(25) }
        if (id === 'last-explicit-navigation-wins') await page.evaluate(() => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route: 'calendar' } })))
        if (id === 'delayed-project-click' || id === 'last-explicit-navigation-wins') await page.getByText('Projects', { exact: true }).first().click()
        await control('release-resident')
        await waitForBrowserCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
        await page.waitForTimeout(800)
        if (id === 'bare-default-resident') {
          await page.getByTestId('resident-assistant-surface').waitFor({ state: 'visible', timeout: 5000 })
        } else {
          await page.getByText('Select a project to view its details', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
          assert.equal(await page.getByTestId('resident-assistant-surface').count(), 0)
        }
        checks.push(id)
      } catch (error) { failures.push({ id, error: String(error) }) }
      finally {
        run.json(id + '.json', { url: page.url(), text: await page.locator('body').innerText().catch(() => ''), errors })
        await page.screenshot({ path: join(run.directory, id + '.png'), fullPage: true }).catch(() => {})
        await context.close()
      }
    }
    run.json('scenarios.json', { checks, failures, errors }); assert.deepEqual(errors, []); assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Real production WebUI and Host; Electron native window input is not covered.'])
  } finally { await control('release-resident').catch(() => {}); await launched.close(); writeFileSync(join(run.directory, 'server.log'), child.stdout() + child.stderr()); await child.stop() }
})

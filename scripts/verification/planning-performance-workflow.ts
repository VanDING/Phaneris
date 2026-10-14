import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { startProcess, testSecret } from './fixtures/governance-process-support'

interface Metrics {
  reads: { channel: string; workspaceId: string; elapsedMs: number; bytes: number; rows: number }[]
  pushes: { channel: string; workspaceId: string; at: number }[]
  projections: { rows: number; elapsedMs: number }[]
  inFlight: number; maxInFlight: number; held: boolean; fixtureSha256: string; count: number; memory: { rss: number }
  failedReads: number
  failedWrites: number
}

await verificationWorkflow('planning-performance', async run => {
  const root = resolve(import.meta.dir, '../..'), config = join(run.directory, 'config')
  mkdirSync(config, { recursive: true })
  if (process.env.PHANERIS_C02_SKIP_BUILD !== '1') {
    const build = Bun.spawn([process.execPath, 'run', 'webui:build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
    writeFileSync(join(run.directory, 'build.log'), stdout + stderr)
    assert.equal(exitCode, 0, 'Production WebUI build failed; see build.log')
  }
  const dist = join(root, 'apps/webui/dist'); assert(existsSync(join(dist, 'index.html')), 'Build the production Web UI first')
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  run.json('build-hashes.json', Object.fromEntries(readdirSync(dist, { recursive: true, encoding: 'utf8' }).map(String).filter(file => /\.(js|css|html|wasm)$/.test(file)).map(file => [file.replaceAll('\\', '/'), hash(join(dist, file))])))
  const child = await startProcess({ config, ready: false, entry: join(import.meta.dir, 'fixtures/planning-performance-server.ts'), extra: { PHANERIS_C02_SIZE: process.env.PHANERIS_C02_SIZE ?? '1000' } })
  try {
    const readyDeadline = Date.now() + 120_000
    while (!child.url) {
      assert(child.process.exitCode === null && Date.now() < readyDeadline, 'Synthetic fixture preparation failed: ' + child.stderr().slice(-3000))
      await new Promise(resolveReady => setTimeout(resolveReady, 50))
    }
  } catch (error) { writeFileSync(join(run.directory, 'server.log'), child.stdout() + child.stderr()); await child.stop('SIGKILL'); throw error }
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' })
  const base = child.url.replace(/^ws/, 'http'), page = await context.newPage(), errors: string[] = [], checks: string[] = [], samples: unknown[] = []
  const consoleMessages: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => consoleMessages.push(message.type() + ': ' + message.text()))
  const control = async (command: string, values: Record<string, unknown> = {}) => {
    const response = await fetch(base + '/__planning', { method: 'POST', headers: { authorization: `Bearer ${testSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ command, ...values }), signal: AbortSignal.timeout(20_000) })
    assert(response.ok, await response.clone().text()); return response.json() as Promise<Metrics>
  }
  const navigate = (target: typeof page, route: string) => target.evaluate(route => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route } })), route)
  const quiet = async () => { await page.waitForTimeout(650); await waitForBrowserCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected') }
  let tracing = false
  let secondaryContext: import('playwright').BrowserContext | undefined
  try {
    await page.clock.setSystemTime(new Date('2026-10-14T04:00:00Z'))
    await context.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    assert((await context.request.post(base + '/api/auth', { data: { password: testSecret } })).ok())
    await context.tracing.start({ screenshots: true, snapshots: true }); tracing = true
    await page.goto(base, { waitUntil: 'networkidle', timeout: 120_000 })
    await waitForBrowserCondition(page, async () => Boolean(window.electronAPI) && (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    await page.getByTestId('app-splash').waitFor({ state: 'hidden', timeout: 60_000 })
    // The transport connects before NavigationProvider mounts during startup.
    await page.getByText('Projects', { exact: true }).first().click()
    await page.getByText('Select a project to view its details', { exact: true }).waitFor({ timeout: 10_000 })
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'))
    await quiet()
    const budget = { warmPlanningMs: 2000, inputTwoFramesMs: 250, rendererHeapBytes: 256 * 1024 * 1024, backendRssBytes: 1024 * 1024 * 1024 }
    for (let repeat = 0; repeat < 3; repeat++) {
      await navigate(page, 'projects'); await page.getByText('Select a project to view its details', { exact: true }).waitFor({ timeout: 10_000 }); await quiet(); await control('reset')
      const begin = performance.now(); await navigate(page, 'calendar')
      await page.locator('[data-calendar-entry="planning-00000"]').first().waitFor({ timeout: 20_000 })
      await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))))
      const elapsedMs = performance.now() - begin; await quiet()
      const mount = await control('metrics')
      await control('reset')
      await page.evaluate(index => window.electronAPI.updateWorkItem('planning', 'planning-00000', { progress: index + 1 }), repeat)
      await quiet(); const write = await control('metrics')
      samples.push({ repeat, elapsedMs, mount, write })
    }
    run.json('planning-performance.json', { budget, samples, checks, errors })
    const typed = samples as { elapsedMs: number; mount: Metrics; write: Metrics }[]
    assert(typed.every(sample => sample.mount.reads.length === 1 && sample.mount.reads[0]!.channel === 'workItems:list'), 'Calendar must load one shared WorkItem projection; preserve baseline metrics on failure')
    checks.push('calendar-three-samples-one-shared-projection')
    assert(typed.every(sample => sample.write.pushes.filter(event => event.channel === 'workItems:changed').length === 1 && sample.write.pushes.filter(event => event.channel === 'calendar:changed').length === 1), 'One write must have one coalesced owner per compatibility channel')
    checks.push('single-write-three-samples-one-broadcast-owner')
    assert(typed.every(sample => sample.write.reads.length === 1), 'One invalidation must cause one collection read per window')
    checks.push('single-invalidation-three-samples-one-read')
    assert(typed.every(sample => sample.elapsedMs <= budget.warmPlanningMs), 'Warm planning navigation exceeded the unchanged 2000ms budget')
    checks.push('all-warm-planning-samples-within-existing-budget')
    const expectedRows = Number(process.env.PHANERIS_C02_SIZE ?? '1000')
    assert(typed.every(sample => sample.mount.reads[0]!.rows === expectedRows)); checks.push('hidden-archived-draft-excluded-unscheduled-retained')
    secondaryContext = await launched.browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' })
    await secondaryContext.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    assert((await secondaryContext.request.post(base + '/api/auth', { data: { password: testSecret } })).ok())
    await secondaryContext.tracing.start({ screenshots: true, snapshots: true })
    const second = await secondaryContext.newPage(); second.on('pageerror', error => errors.push(error.message))
    await second.clock.setSystemTime(new Date('2026-10-14T04:00:00Z'))
    await second.goto(base, { waitUntil: 'networkidle', timeout: 120_000 }); await waitForBrowserCondition(second, async () => Boolean(window.electronAPI) && (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    await second.getByText('Projects', { exact: true }).first().click({ timeout: 60_000 })
    await navigate(second, 'calendar'); await second.locator('[data-calendar-entry="planning-00000"]').first().waitFor(); await quiet(); await control('reset')
    await control('rename', { patch: { name: 'C02 cross-window verified' } }); await quiet()
    for (const target of [page, second]) await target.locator('[data-calendar-entry="planning-00000"]').filter({ hasText: 'C02 cross-window verified' }).first().waitFor()
    const crossWindow = await control('metrics'); assert.equal(crossWindow.reads.length, 2); checks.push('two-real-clients-converge-from-native-session-edit')
    await control('reset'); await control('burst'); await quiet()
    const burst = await control('metrics')
    for (const workspaceId of ['planning', 'other']) for (const channel of ['workItems:changed', 'calendar:changed']) {
      assert.equal(burst.pushes.filter(event => event.workspaceId === workspaceId && event.channel === channel).length, 1)
    }
    assert.equal(burst.reads.length, 2); checks.push('ten-writes-and-two-workspaces-coalesce-without-losing-notifications')
    for (const target of [page, second]) await target.locator('[data-calendar-entry="planning-00000"]').filter({ hasText: 'C02 burst 10' }).first().waitFor()
    await page.evaluate(() => window.electronAPI.sessionCommand('planning-00000', { type: 'archive' })); await quiet()
    for (const target of [page, second]) assert.equal(await target.locator('[data-calendar-entry="planning-00000"]').count(), 0)
    await page.evaluate(() => window.electronAPI.sessionCommand('planning-00000', { type: 'unarchive' })); await quiet()
    for (const target of [page, second]) await target.locator('[data-calendar-entry="planning-00000"]').first().waitFor()
    checks.push('native-archive-and-unarchive-converge-in-both-windows')
    // Respect the existing 5s guard against observing our own metadata writes.
    await page.waitForTimeout(5100)
    await control('external-name', { patch: { name: 'C02 external metadata verified' } })
    for (const target of [page, second]) await target.locator('[data-calendar-entry="planning-00000"]').filter({ hasText: 'C02 external metadata verified' }).first().waitFor()
    checks.push('external-session-header-edit-invalidates-both-projections')
    await second.screenshot({ path: join(run.directory, 'calendar-second-window.png') })
    await secondaryContext.tracing.stop({ path: join(run.directory, 'second-trace.zip') }); await secondaryContext.close(); secondaryContext = undefined
    await quiet()
    await control('reset'); await control('hold-list')
    await control('planning', { patch: { progress: 41 } })
    const holdDeadline = Date.now() + 10_000
    while (!(await control('metrics')).held) { assert(Date.now() < holdDeadline, 'Expected a held real list snapshot'); await page.waitForTimeout(30) }
    await control('rename', { patch: { name: 'C02 after held snapshot' } }); await quiet(); await control('release'); await quiet()
    await page.locator('[data-calendar-entry="planning-00000"]').filter({ hasText: 'C02 after held snapshot' }).first().waitFor()
    const raced = await control('metrics'); assert.equal(raced.reads.length, 2); assert.equal(raced.maxInFlight, 1); checks.push('in-flight-invalidations-collapse-to-one-follow-up')
    await control('reset'); await control('fail-list'); await control('planning', { patch: { progress: 42 } }); await quiet()
    assert.equal((await control('metrics')).failedReads, 1)
    await page.locator('[data-calendar-entry="planning-00000"]').first().waitFor()
    await control('rename', { patch: { name: 'C02 after read retry' } }); await quiet()
    await page.locator('[data-calendar-entry="planning-00000"]').filter({ hasText: 'C02 after read retry' }).first().waitFor()
    assert.equal((await control('metrics')).reads.length, 1); checks.push('rejected-read-keeps-last-snapshot-and-recovers-on-invalidation')
    await control('reset'); await control('fail-write')
    const originalDates = await control('facts')
    const event = await page.locator('[data-calendar-entry="planning-00000"]').first().boundingBox()
    const cell = await page.locator('[role="gridcell"][data-date="2026-10-14"]').boundingBox(); assert(event && cell)
    await page.mouse.move(event.x + event.width / 3, event.y + event.height / 2); await page.mouse.down()
    await page.mouse.move(event.x + event.width / 3 + cell.width, event.y + event.height / 2, { steps: 12 }); await page.mouse.up()
    await page.getByText('Could not reschedule', { exact: true }).first().waitFor()
    assert.equal((await control('metrics')).failedWrites, 1); assert.deepEqual(await control('facts'), originalDates)
    checks.push('real-calendar-drag-rejection-shows-error-and-keeps-persisted-dates')
    await control('reset'); await page.evaluate(() => window.electronAPI.reconnectTransport()); await quiet()
    await page.locator('[data-calendar-entry="planning-00000"]').filter({ hasText: 'C02 after read retry' }).first().waitFor()
    assert.equal((await control('metrics')).reads.length, 1); checks.push('reconnect-revalidates-shared-projection-once')
    await navigate(page, 'projects'); await page.getByText('Select a project to view its details', { exact: true }).waitFor(); await quiet(); await control('reset')
    await control('rename', { patch: { name: 'C02 changed while inactive' } }); await quiet(); assert.equal((await control('metrics')).reads.length, 0); checks.push('no-read-after-last-consumer-unsubscribes')
    await navigate(page, 'calendar'); await page.locator('[data-calendar-entry="planning-00000"]').filter({ hasText: 'C02 changed while inactive' }).first().waitFor(); checks.push('remount-revalidates-inactive-cache')
    const legacy = await page.evaluate(() => window.electronAPI.createCalendarEntry('planning', { title: 'A C02 legacy entry', date: '2026-10-14', endDate: '2026-10-15', time: '09:30', endTime: '11:45', note: 'Legacy note' }))
    // Month overflow intentionally hides timed entries below the all-day rows.
    // Use the existing Day control to inspect the actual timed event.
    await quiet(); await page.getByRole('radio', { name: 'Day', exact: true }).click()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await page.locator(`[data-calendar-entry="${legacy.id}"]`).first().waitFor()
    assert.equal(legacy.time, '09:30'); assert.equal(legacy.endTime, '11:45')
    const updated = await page.evaluate(id => window.electronAPI.updateCalendarEntry('planning', id, { title: 'A C02 legacy updated', date: '2026-10-14', endDate: '2026-10-16', allDay: true, note: 'Updated legacy note' }), legacy.id)
    await quiet(); await page.getByRole('radio', { name: 'Month', exact: true }).click()
    await page.locator(`[data-calendar-entry="${legacy.id}"]`).filter({ hasText: 'A C02 legacy updated' }).first().waitFor()
    assert.equal(updated.endDate, '2026-10-16'); assert.equal(updated.note, 'Updated legacy note'); assert.equal(updated.allDay, true)
    checks.push('legacy-calendar-create-update-notifies-modern-shared-projection')
    await page.evaluate(id => window.electronAPI.deleteCalendarEntry('planning', id), legacy.id); await quiet()
    assert.equal(await page.locator(`[data-calendar-entry="${legacy.id}"]`).count(), 0)
    const retained = await page.evaluate(async id => (await window.electronAPI.listWorkItems('planning')).find(item => item.id === id), legacy.id)
    assert(retained); assert.equal(retained.startAt, undefined); assert.equal(retained.dueAt, undefined)
    checks.push('legacy-calendar-delete-clears-dates-and-retains-backing-session')
    await control('reset'); await page.evaluate(id => window.electronAPI.deleteSession(id), legacy.id); await quiet()
    assert.equal((await control('metrics')).reads.length, 1)
    assert.equal((await page.evaluate(() => window.electronAPI.listWorkItems('planning'))).some(item => item.id === legacy.id), false)
    checks.push('native-session-delete-invalidates-planning-projection')
    await page.keyboard.press('Control+.')
    const search = page.locator('input[placeholder="Search tasks…"]')
    await search.waitFor()
    {
      const inputMs = await search.evaluate(element => new Promise<number>(resolveFrame => {
        const start = performance.now(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, 'C02'); element.dispatchEvent(new Event('input', { bubbles: true })); requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame(performance.now() - start)))
      }))
      assert(inputMs <= budget.inputTwoFramesMs); samples.push({ inputMs }); checks.push('planning-input-two-frames-within-existing-budget')
    }
    // Match scripts/performance/run.ts: browser-owned CDP metrics also remain
    // available when Playwright's calendar clock wraps the page performance API.
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable')
    const nativeMetrics = await cdp.send('Performance.getMetrics')
    const memory = nativeMetrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value
    const backendMemory = (await control('metrics')).memory
    run.json('memory-sample.json', { renderer: { JSHeapUsedSize: memory }, backend: backendMemory, nativeMetrics })
    assert(memory !== undefined && memory <= budget.rendererHeapBytes); assert(backendMemory.rss <= budget.backendRssBytes); checks.push('sampled-renderer-and-host-memory-within-existing-budgets')
    const facts = await control('facts'); run.json('session-facts.json', facts)
    run.json('planning-performance.json', { budget, samples, checks, errors, crossWindow, burst, raced, memory, fixture: { count: expectedRows, sha256: typed[0]!.mount.fixtureSha256 } })
    await page.screenshot({ path: join(run.directory, 'calendar-final.png') }); assert.deepEqual(errors, [])
    run.complete(checks, ['Local Windows production WebUI and real WebSocket/SessionManager; native Electron and other operating systems require their own runs.', 'Physical presentation and peak memory are not measured; frame and sampled memory proxies retain existing budgets.'])
  } finally {
    run.json('control-final.json', await control('metrics').catch(error => ({ error: String(error) })))
    if (secondaryContext) {
      await secondaryContext.tracing.stop({ path: join(run.directory, 'second-trace.zip') }).catch(() => {})
      await secondaryContext.close()
    }
    await page.screenshot({ path: join(run.directory, 'browser-final.png') }).catch(() => {})
    run.json('browser-final.json', { checks, errors, samples, consoleMessages, url: page.url(), body: await page.locator('body').innerText().catch(() => '') })
    writeFileSync(join(run.directory, 'server.log'), child.stdout() + child.stderr())
    if (tracing) await context.tracing.stop({ path: join(run.directory, 'trace.zip') })
    await context.close(); await launched.close(); await child.stop()
  }
})

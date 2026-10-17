import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'

await verificationWorkflow('planning-collection', async run => {
  const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'fixtures/planning-collection.tsx')], target: 'browser', outdir: run.directory, naming: 'fixture.js', define: { 'process.env.NODE_ENV': '"development"' } })
  assert(build.success, build.logs.map(String).join('\n'))
  const host = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => new URL(request.url).pathname === '/fixture.js'
    ? new Response(readFileSync(join(run.directory, 'fixture.js')), { headers: { 'content-type': 'text/javascript' } })
    : new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'content-type': 'text/html' } }) })
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext(), page = await context.newPage()
  const checks: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const control = (action: string, ...args: unknown[]) => page.evaluate(({ action, args }) => (window as any).planningFixture[action](...args), { action, args })
  const snapshot = async () => JSON.parse(await page.locator('#snapshot').innerText())
  const settled = () => waitForBrowserCondition(page, () => { const element = document.querySelector('#snapshot'); return Boolean(element) && !JSON.parse(element!.textContent!).loading })
  const scope = async (workspace: string | null) => {
    await control('scope', workspace)
    await waitForBrowserCondition(page, expected => {
      const element = document.querySelector('#snapshot'), value = element && JSON.parse(element.textContent!)
      return value && value.workspace === expected && !value.loading
    }, workspace)
  }
  const held = () => waitForBrowserCondition(page, () => (window as any).planningFixture.metrics().heldRead)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await page.goto(host.url.origin); await settled()
    assert.equal((await control('metrics')).reads.length, 1); assert.equal((await control('metrics')).listeners, 1); assert.equal((await control('metrics')).transportListeners, 1)
    checks.push('strict-mode-two-hooks-one-read-and-subscription')
    await control('configure', { holdRead: true }); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await held()
    await page.getByRole('button', { name: 'Update', exact: true }).click()
    await waitForBrowserCondition(page, () => JSON.parse(document.querySelector('#snapshot')!.textContent!).items.some((item: any) => item.title === 'Accepted local write'))
    await control('releaseRead'); await settled(); assert.equal((await snapshot()).items.find((item: any) => item.id === 'a').title, 'Accepted local write')
    assert.equal((await snapshot()).items.length, 2); checks.push('late-read-keeps-successful-write-and-unmodified-rows')
    await control('configure', { holdRead: true }); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await held()
    await page.getByRole('button', { name: 'Create', exact: true }).click(); await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await control('releaseRead'); await settled(); assert.deepEqual((await snapshot()).items.map((item: any) => item.id).sort(), ['a', 'created'])
    checks.push('late-read-preserves-create-and-delete-tombstone')
    await control('configure', { holdRead: true }); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await held()
    const readsBefore = (await control('metrics')).reads.length
    for (let index = 0; index < 10; index++) await control('change', 'one', 'Last external value')
    await control('releaseRead'); await settled()
    assert.equal((await control('metrics')).reads.length, readsBefore + 1); assert.equal((await control('metrics')).maxActiveReads, 1)
    assert.equal((await snapshot()).items[0].title, 'Last external value'); checks.push('ten-invalidations-one-follow-up-no-overlapping-reads')
    await control('configure', { holdRead: true }); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await held()
    await scope('two'); assert.equal((await snapshot()).items[0].id, 'z')
    await control('releaseRead'); await settled(); assert.equal((await snapshot()).workspace, 'two'); assert.equal((await snapshot()).items[0].id, 'z')
    checks.push('late-old-workspace-read-cannot-pollute-new-scope')
    await scope('one'); await control('configure', { holdWrite: true }); await page.getByRole('button', { name: 'Update', exact: true }).click()
    await waitForBrowserCondition(page, () => (window as any).planningFixture.metrics().heldWrite)
    await scope('two'); await control('releaseWrite'); await page.waitForTimeout(30)
    assert.equal((await snapshot()).items[0].id, 'z'); checks.push('late-old-workspace-write-cannot-pollute-new-scope')
    await scope('one'); await control('configure', { failRead: true }); await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await waitForBrowserCondition(page, () => Boolean(JSON.parse(document.querySelector('#snapshot')!.textContent!).error)); assert.equal((await snapshot()).loading, false)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await settled(); assert.equal((await snapshot()).error, null); checks.push('read-failure-retains-items-and-explicit-retry-recovers')
    await control('configure', { failWrite: true }); const before = (await snapshot()).entries
    await page.getByRole('button', { name: 'Update schedule', exact: true }).click()
    await waitForBrowserCondition(page, () => JSON.parse(document.querySelector('#snapshot')!.textContent!).failure.includes('Injected write rejection'))
    assert.deepEqual((await snapshot()).entries, before); checks.push('calendar-rejected-write-throws-and-keeps-snapshot')
    const writesBefore = (await control('metrics')).writes
    await page.getByRole('button', { name: 'Invalid schedule', exact: true }).click()
    await waitForBrowserCondition(page, () => JSON.parse(document.querySelector('#snapshot')!.textContent!).failure.includes('End date'))
    assert.equal((await control('metrics')).writes, writesBefore); checks.push('invalid-calendar-range-rejected-before-writing')
    await page.getByRole('button', { name: 'Create schedule', exact: true }).click()
    await waitForBrowserCondition(page, () => JSON.parse(document.querySelector('#snapshot')!.textContent!).entries.some((item: any) => item.title === 'Timed calendar entry'))
    const timed = (await snapshot()).entries.find((item: any) => item.title === 'Timed calendar entry')
    assert.equal(timed.time, '01:30'); assert.equal(timed.endTime, '03:45'); assert.equal(timed.endDate, '2026-11-02'); assert.equal(timed.note, 'Calendar note'); assert.equal(timed.projectId, 'project-a')
    checks.push('calendar-create-retains-local-times-inclusive-end-note-project')
    await page.getByRole('button', { name: 'Update schedule', exact: true }).click()
    await waitForBrowserCondition(page, () => JSON.parse(document.querySelector('#snapshot')!.textContent!).entries.some((item: any) => item.title === 'Calendar updated'))
    const allDay = (await snapshot()).entries.find((item: any) => item.id === 'a')
    assert.equal(allDay.allDay, true); assert.equal(allDay.time, undefined); assert.equal(allDay.projectId, undefined); assert.equal(allDay.note, undefined)
    checks.push('calendar-update-all-day-and-clears-omitted-optional-fields')
    await page.getByRole('button', { name: 'Clear schedule', exact: true }).click()
    await waitForBrowserCondition(page, () => !JSON.parse(document.querySelector('#snapshot')!.textContent!).entries.some((item: any) => item.id === 'a'))
    assert((await snapshot()).items.some((item: any) => item.id === 'a')); checks.push('clear-schedule-keeps-work-item-and-session-identity')
    const reconnectReads = (await control('metrics')).reads.length
    await control('connection', 'reconnecting'); await control('connection', 'connected'); await control('connection', 'connected'); await settled()
    assert.equal((await control('metrics')).reads.length, reconnectReads + 1); checks.push('connection-transition-revalidates-once')
    await control('mount', false); await page.getByText('Inactive', { exact: true }).waitFor(); await page.waitForTimeout(30)
    assert.equal((await control('metrics')).listeners, 0); assert.equal((await control('metrics')).transportListeners, 0)
    const inactiveReads = (await control('metrics')).reads.length; await control('change', 'one', 'Changed while inactive'); assert.equal((await control('metrics')).reads.length, inactiveReads)
    checks.push('last-unsubscribe-releases-both-listeners-and-stops-reads')
    await control('mount', true); await settled(); assert.equal((await snapshot()).items[0].title, 'Changed while inactive'); assert.equal((await control('metrics')).reads.length, inactiveReads + 1)
    checks.push('remount-revalidates-retained-cache-once')
    await control('configure', { holdRead: true }); await control('scope', 'initial'); await held()
    await page.getByRole('button', { name: 'Update', exact: true }).click()
    await waitForBrowserCondition(page, () => JSON.parse(document.querySelector('#snapshot')!.textContent!).items.some((item: any) => item.title === 'Accepted local write'))
    await control('releaseRead'); await settled()
    assert.equal((await snapshot()).items.length, 2); assert.equal((await snapshot()).items.find((item: any) => item.id === 'a').title, 'Accepted local write')
    checks.push('initial-read-merges-successful-write-with-all-other-rows')
    await scope(null); assert.deepEqual((await snapshot()).items, []); assert.deepEqual((await snapshot()).entries, []); checks.push('null-workspace-has-no-stale-projection')
    run.json('planning-collection.json', { checks, metrics: await control('metrics'), facts: await control('facts'), errors }); await page.screenshot({ path: join(run.directory, 'collection-final.png') })
    assert.deepEqual(errors, []); run.complete(checks, ['Deterministic browser hook race harness uses an explicit in-memory API; real host, transport, and performance are covered separately by planning-performance.'])
  } finally {
    run.json('browser-final.json', { checks, errors, body: await page.locator('body').innerText().catch(() => '') })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await launched.close(); host.stop(true)
  }
})

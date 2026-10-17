import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer, type UserConfig, type PluginOption } from 'vite'
import rendererConfig from '../../apps/electron/vite.config'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'

async function fixturePlugins(plugins: PluginOption[]): Promise<PluginOption[]> {
  const result: PluginOption[] = []
  for (const value of plugins) {
    const plugin = await value
    if (Array.isArray(plugin)) result.push(...await fixturePlugins(plugin))
    else if (!plugin || plugin.name !== '@rolldown/plugin-babel') result.push(plugin)
  }
  return result
}

await verificationWorkflow('gantt-reschedule', async run => {
  const root = resolve(import.meta.dir, '../..'), ws = join(run.directory, 'workspace'), config = join(run.directory, 'config')
  mkdirSync(ws); mkdirSync(config); process.env.PHANERIS_CONFIG_DIR = config
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'fixture', name: 'Gantt acceptance', rootPath: ws, createdAt: 1 }], activeWorkspaceId: 'fixture' }))
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
  const storage = await import('../../packages/shared/src/sessions/storage')
  const { registerWorkItemHandlers } = await import('../../packages/server-core/src/handlers/rpc/work-items')
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
  const runtime = createDurableRuntime(), manager = new SessionManager(runtime)
  manager.waitForInit = async () => {} // Explicitly seeded below; no personal config/session scan.
  ;(manager as any).eventSink = () => {}
  const workspace = { id: 'fixture', slug: 'fixture', name: 'Gantt acceptance', rootPath: ws, createdAt: 1 }
  async function seed(name: string, startAt: string, dueAt: string, parentSessionId?: string, isMilestone?: boolean) {
    const session = await storage.createSession(ws, { name, startAt, dueAt, parentSessionId, isMilestone, permissionMode: 'safe' })
    ;(manager as any).registerManagedSession(createManagedSession(session, workspace, { messagesLoaded: true })); return session.id
  }
  const summary = await seed('Summary', '2026-10-28', '2026-11-07'), leaf = await seed('Editable leaf', '2026-10-30', '2026-11-03', summary)
  const timed = await seed('Timed DST leaf', '2026-10-30T14:30:45Z', '2026-11-03T21:15:20Z'), milestone = await seed('Milestone', '2026-11-02', '2026-11-02', undefined, true)
  const handlers = new Map<string, (...args: any[]) => any>()
  registerWorkItemHandlers({ handle: (channel: string, fn: (...args: any[]) => any) => handlers.set(channel, fn), push: () => {} } as never, { sessionManager: manager } as never)
  let fail = false, delay = 0; const writes: unknown[] = []
  const host = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
    if (request.method === 'OPTIONS') return new Response(null, { headers })
    try {
      const action = new URL(request.url).pathname.slice(1), args = await request.json() as any[]
      if (action === 'control') { fail = args[0]?.fail ?? false; delay = args[0]?.delay ?? 0; return Response.json({}, { headers }) }
      if (action === 'writes') return Response.json(writes, { headers })
      if (action === 'seed-gap') return Response.json(await seed('Spring gap leaf', '2027-03-13T07:30:45Z', '2027-03-15T12:00:00Z'), { headers })
      if (action === 'update') { writes.push(args); if (delay) await Bun.sleep(delay); if (fail) throw new Error('Injected schedule save failure') }
      const result = await handlers.get(action === 'list' ? RPC_CHANNELS.workItems.LIST : RPC_CHANNELS.workItems.UPDATE)!({}, 'fixture', ...args)
      return Response.json(result, { headers })
    } catch (error) { return new Response(String(error), { status: 500, headers }) }
  } })
  const fixture = '/scripts/verification/fixtures/gantt-reschedule.tsx', html = join(run.directory, 'index.html'), prefix = '/' + run.directory.slice(root.length + 1).replaceAll('\\', '/')
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`)
  const viteConfig = rendererConfig as UserConfig
  // This fixture does not edit source files. Avoid atom-debug transforms over
  // prebundled dependencies and filesystem watchers over the whole workspace.
  // Dependency optimizer reloads remain available through Vite's HMR channel.
  const plugins = await fixturePlugins(viteConfig.plugins ?? [])
  const vite = await createServer({ ...viteConfig, configFile: false, plugins, root, cacheDir: join(root, '.cache/vite-gantt-reschedule'), server: { host: '127.0.0.1', port: 0, open: false, watch: null }, optimizeDeps: { ...viteConfig.optimizeDeps, entries: [join(root, fixture.slice(1))] } })
  await vite.listen(); const browser = await launchWorkflowBrowser(), context = await browser.browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'America/New_York' }), page = await context.newPage()
  let tracing = false
  const checks: string[] = [], errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const invoke = (action: string, args: unknown[] = []) => page.evaluate(({ action, args }) => (window as any).ganttFixture.invoke(action, args), { action, args })
  const dateValues = () => page.getByRole('dialog').locator('input[type=date]').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))
  const waitForClosedDates = () => page.getByRole('dialog').waitFor({ state: 'detached' })
  const cancelDates = async (title = 'Editable leaf') => {
    // Radix keeps the closing popover mounted for its exit animation, then
    // restores trigger focus asynchronously. A new task can otherwise lose
    // focus and close immediately when the previous scope finishes cleanup.
    const trigger = await page.getByRole('button', { name: `Reschedule ${title}`, exact: true }).elementHandle(); assert(trigger)
    try {
      const wasOpen = await trigger.getAttribute('aria-expanded') === 'true'
      await page.keyboard.press('Escape'); await waitForClosedDates()
      // A save/rollback can replace the row and its trigger entirely. Only a
      // surviving open trigger has a pending focus restoration to await.
      if (wasOpen) await page.waitForFunction(element => !element.isConnected || document.activeElement === element, trigger)
    } finally { await trigger.dispose() }
  }
  try {
    const url = `http://127.0.0.1:${(vite.httpServer!.address() as any).port}${prefix}/index.html?api=${encodeURIComponent(host.url.origin)}`
    run.json('preparation.json', await warmThemePage(context, url, '.wx-bar'))
    await context.tracing.start({ screenshots: true, snapshots: true }); tracing = true
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.locator('.wx-bar').filter({ hasText: 'Editable leaf' }).first().waitFor({ timeout: 120_000 })
    await page.getByRole('radio', { name: 'Month', exact: true }).click()
    const edit = page.getByRole('button', { name: 'Reschedule Editable leaf', exact: true })
    await edit.focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor(); checks.push('keyboard-opens-date-controls')
    await page.getByRole('dialog').locator('input[type=date]').nth(0).fill('2026-10-31'); await page.getByRole('dialog').locator('input[type=date]').nth(1).fill('2026-11-04')
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await waitForClosedDates()
    assert.equal((manager.getSessions('fixture').find(item => item.id === leaf))?.dueAt, '2026-11-04'); checks.push('inclusive-end-saved-through-real-session-planning')
    const before = (await invoke('writes')).length
    await edit.click(); await page.getByRole('dialog').locator('input[type=date]').nth(1).fill('2026-11-08'); await cancelDates(); assert.equal((await invoke('writes')).length, before); checks.push('keyboard-cancel-does-not-write')
    const bar = page.locator('.wx-bar').filter({ hasText: 'Editable leaf' }).first(), box = await bar.boundingBox(); assert(box)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 44, box.y + box.height / 2, { steps: 8 }); await page.mouse.up()
    await waitForBrowserCondition(page, async expected => (await (window as any).ganttFixture.invoke('writes')).length >= expected, before + 1)
    await edit.waitFor({ state: 'visible' }); await waitForBrowserCondition(page, () => !(document.querySelector('[aria-label="Reschedule Editable leaf"]') as HTMLButtonElement)?.disabled)
    checks.push('pointer-drag-commits-once')
    const dragged = manager.getSessions('fixture').find(item => item.id === leaf)!
    assert(dragged.startAt! > '2026-10-31'); assert(dragged.dueAt! > '2026-11-04')
    // A partially clipped bar can still be dragged from its centre. Scroll its
    // end into view before exercising the resize edge and leave movement room.
    await bar.evaluate(element => {
      element.scrollIntoView({ block: 'nearest', inline: 'end' })
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.scrollWidth > parent.clientWidth && /auto|scroll/.test(getComputedStyle(parent).overflowX)) {
          parent.scrollLeft += Math.max(0, element.getBoundingClientRect().right - parent.getBoundingClientRect().right + 90)
        }
      }
    })
    const movedCount = writes.length, movedBox = await bar.boundingBox(); assert(movedBox)
    run.json('resize-hit-test.json', { box: movedBox, element: await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.outerHTML, { x: movedBox.x + movedBox.width - 8, y: movedBox.y + movedBox.height / 2 }) })
    await page.mouse.move(movedBox.x + movedBox.width - 8, movedBox.y + movedBox.height / 2); await page.mouse.down(); await page.mouse.move(movedBox.x + movedBox.width + 48, movedBox.y + movedBox.height / 2, { steps: 8 }); await page.mouse.up()
    await waitForBrowserCondition(page, async expected => (await (window as any).ganttFixture.invoke('writes')).length > expected, movedCount)
    await waitForBrowserCondition(page, () => !(document.querySelector('[aria-label="Reschedule Editable leaf"]') as HTMLButtonElement)?.disabled)
    assert.equal(manager.getSessions('fixture').find(item => item.id === leaf)?.startAt, dragged.startAt); checks.push('resize-preserves-start-and-inclusive-end')
    const resizeCount = writes.length, cancelBox = await bar.boundingBox(); assert(cancelBox)
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2); await page.mouse.down(); await page.mouse.move(cancelBox.x + cancelBox.width / 2 + 44, cancelBox.y + cancelBox.height / 2, { steps: 8 }); await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal(writes.length, resizeCount); checks.push('escape-cancels-pointer-reschedule')
    const pointerBox = await bar.boundingBox(); assert(pointerBox)
    await page.mouse.move(pointerBox.x + pointerBox.width / 2, pointerBox.y + pointerBox.height / 2); await page.mouse.down(); await page.mouse.move(pointerBox.x + pointerBox.width / 2 + 44, pointerBox.y + pointerBox.height / 2, { steps: 8 }); await bar.dispatchEvent('pointercancel'); await page.mouse.up(); assert.equal(writes.length, resizeCount); checks.push('pointer-cancellation-does-not-write')
    await invoke('control', [{ fail: true }]); await edit.click(); const old = await dateValues()
    await page.getByRole('dialog').locator('input[type=date]').nth(1).fill('2026-11-20'); await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Could not save the schedule. Check the date range and try again.', { exact: true }).first().waitFor(); await cancelDates(); await edit.click(); assert.deepEqual(await dateValues(), old); await cancelDates(); checks.push('save-failure-rolls-back-and-reports')
    await invoke('control', [{ delay: 800 }]); await edit.click(); await page.getByRole('dialog').locator('input[type=date]').nth(1).fill('2026-11-10'); await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.evaluate(() => { (window as any).ganttFixture.broadcast(); (window as any).ganttFixture.remount() })
    await edit.waitFor(); await page.waitForTimeout(1000); await edit.click(); assert.equal((await dateValues())[1], '2026-11-10'); await cancelDates(); checks.push('broadcast-and-remount-preserve-inflight-reschedule')
    assert.equal(await page.getByRole('button', { name: 'Reschedule Summary', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Reschedule Milestone', exact: true }).count(), 0); checks.push('summaries-and-milestones-are-readonly')
    await invoke('control', [{}]); await page.getByRole('button', { name: 'Reschedule Timed DST leaf', exact: true }).click()
    await page.getByRole('dialog').locator('input[type=date]').nth(0).fill('2026-11-02'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await waitForClosedDates()
    const result = manager.getSessions('fixture').find(item => item.id === timed)!
    assert.equal(result.startAt, '2026-11-02T15:30:45.000Z'); assert.equal(result.dueAt, '2026-11-03T21:15:20Z'); checks.push('dst-clock-seconds-and-untouched-end-preserved')
    await edit.click(); await page.getByRole('dialog').locator('input[type=date]').nth(1).fill('2026-11-30'); await page.getByRole('dialog').locator('input[type=date]').nth(0).fill('2026-11-30'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await waitForClosedDates()
    assert.equal(manager.getSessions('fixture').find(item => item.id === leaf)?.startAt, '2026-11-30'); assert.equal(manager.getSessions('fixture').find(item => item.id === leaf)?.dueAt, '2026-11-30'); checks.push('single-day-inclusive-range-preserved')
    const search = page.getByPlaceholder('Search tasks…'); await search.fill('Summary')
    await page.getByRole('button', { name: /^Summary/ }).first().waitFor(); assert.equal(await page.getByRole('button', { name: 'Reschedule Summary', exact: true }).count(), 0)
    await search.fill(''); checks.push('filtered-out-children-do-not-make-summary-editable')
    const gap = await invoke('seed-gap'); await page.evaluate(() => (window as any).ganttFixture.broadcast())
    await page.getByRole('button', { name: 'Reschedule Spring gap leaf', exact: true }).click(); await page.getByRole('dialog').locator('input[type=date]').nth(0).fill('2027-03-14')
    const gapWrites = writes.length; await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Could not save the schedule. Check the date range and try again.', { exact: true }).first().waitFor(); assert.equal(writes.length, gapWrites); assert.equal(manager.getSessions('fixture').find(item => item.id === gap)?.startAt, '2027-03-13T07:30:45Z'); checks.push('nonexistent-dst-clock-refused-without-write')
    await cancelDates('Spring gap leaf')
    await page.screenshot({ path: join(run.directory, 'gantt-desktop.png') }); await page.setViewportSize({ width: 760, height: 800 }); await page.screenshot({ path: join(run.directory, 'gantt-760.png') })
    assert.deepEqual(errors, []); run.json('gantt-reschedule.json', { checks, writes, leaf, timed, summary, milestone, projection: manager.getSessions('fixture').map(item => ({ id: item.id, startAt: item.startAt, dueAt: item.dueAt })) })
    run.complete(checks, ['Browser over real Gantt and real WorkItem handler/SessionManager; loopback bridge replaces transport only. Physical touch and signed builds are separate.'])
  } finally {
    run.json('browser-state.json', { url: page.url(), body: await page.locator('body').innerText().catch(() => ''), bars: await page.locator('.wx-bar').evaluateAll(elements => elements.map(element => element.outerHTML.slice(0, 1300))), errors, checks, writes, sessions: manager.getSessions('fixture') })
    await page.screenshot({ path: join(run.directory, 'browser-final.png') }).catch(() => {})
    if (tracing) await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await browser.close(); await vite.close(); host.stop(true); await runtime.close()
  }
})

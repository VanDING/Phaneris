#!/usr/bin/env bun
import { spawn, execFileSync } from 'node:child_process'
import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { checkEnvironment, manifest, root, run } from '../check-environment'
import { profiles, type ProfileName } from './fixtures'
import { measurePiStartup } from './pi-startup'

checkEnvironment()
const profile: ProfileName = process.argv.includes('--smoke') ? 'smoke' : 'baseline'
const options = profiles[profile]
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length)
const output = resolve(outputArg ?? join(root, '.cache/performance', profile + '.json'))
const reusedBuilds = process.argv.includes('--skip-build')
// Local regression budgets, not universal device guarantees. Every raw sample is retained.
const budgets = { navigationMs: 3000, coldSessionMs: 3000, warmSwitchMs: 2000, inputToTwoFramesMs: 250,
  firstStreamMs: 1500, rendererHeapBytes: 256 * 1024 * 1024, backendRssBytes: 1024 * 1024 * 1024 }
if (!reusedBuilds) {
  await run(['run', 'webui:build'])
  await run(['run', 'build'], join(root, 'packages/pi-agent-server'))
}
// `git.revision` describes the source tree, not the artifact under test: with
// --skip-build the two can differ, so record what was actually measured.
const bundles = ['apps/webui/dist/index.html', 'packages/pi-agent-server/dist/index.js'].map(path => {
  if (!existsSync(join(root, path))) throw new Error(`Build required: ${path}`)
  const stats = statSync(join(root, path))
  return { path, bytes: stats.size, modifiedAt: new Date(stats.mtimeMs).toISOString() }
})
mkdirSync(dirname(output), { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'craft-performance-'))
const token = crypto.randomUUID() + crypto.randomUUID()
const environment: NodeJS.ProcessEnv = { PHANERIS_CONFIG_DIR: scratch, PHANERIS_PERF_TOKEN: token, PHANERIS_PERF_PROFILE: profile }
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
  if (process.env[key]) environment[key] = process.env[key]
}
const serverLog: string[] = []
const started = performance.now()
const server = spawn(process.execPath, [join(root, 'scripts/performance/server.ts')], {
  cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
})
let browser: Browser | undefined
let page: Page | undefined
const report: Record<string, unknown> = {
  schemaVersion: 1, profile, options, createdAt: new Date().toISOString(),
  git: { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() },
  machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(), bun: Bun.version, bunExecutableArch: process.arch,
    node: execFileSync('node', ['--version'], { encoding: 'utf8' }).trim() },
  builds: { reused: reusedBuilds, bundles },
  version: manifest.version,
  budgets,
  scope: 'Production Web UI + real WebSocket RPC + SessionManager, synthetic offline workload. No Electron main/native startup or provider inference. Idle eviction uses an advanced clock; soak uses real time. Frame proxy = marker present plus two requestAnimationFrame callbacks, not hardware presentation. RSS is sampled, not peak or retained heap.',
  offlineNetworkPolicy: 'Fixture HTTP CSP blocks external network in the browser; local production assets have no Playwright request interception.',
}
function log(line: string) { serverLog.push(line); if (serverLog.length > 300) serverLog.shift() }
createInterface({ input: server.stderr }).on('line', log)
async function frames() { await page!.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))) }
try {
  const ready = await new Promise<{ port: number; bootMs: number; sessions: { id: string; messageCount: number }[]; metrics: unknown }>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture server startup timed out')), 60_000)
    createInterface({ input: server.stdout }).on('line', line => {
      log(line)
      if (line.startsWith('PERF_READY ')) { clearTimeout(timer); resolveReady(JSON.parse(line.slice(11))) }
    })
    server.once('error', error => { clearTimeout(timer); reject(error) })
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture server exited ${code}`)) })
  })
  report.serverStartup = { processToFixtureReadyMs: performance.now() - started, bootstrapMs: ready.bootMs, initial: ready.metrics }
  const origin = `http://127.0.0.1:${ready.port}`
  async function control(command: string, sessionId?: string) {
    const response = await fetch(origin + '/__perf', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command, sessionId }), signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Fixture ${command}: ${await response.text()}`)
    return response.json()
  }
  browser = await chromium.launch({ channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) })
  report.chromium = browser.version()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] })
  const blockedRequests: string[] = []
  const login = await context.request.post(origin + '/api/auth', { data: { password: token } })
  if (!login.ok()) throw new Error(`Fixture login failed ${login.status()}`)
  page = await context.newPage()
  page.on('requestfailed', request => {
    const url = request.url()
    if (!url.startsWith(origin + '/') && !url.startsWith('data:') && !url.startsWith('blob:')) blockedRequests.push(url)
  })
  page.setDefaultTimeout(60_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  let wsBytes = 0, wsFrames = 0
  const rpcPending = new Map<string, { channel: string; startedMs: number; navigation: number; resourceKey?: string }>()
  const startupRpc: { channel: string; startedMs: number; elapsedMs: number; navigation: number; resourceKey?: string; resultKind?: string }[] = []
  let observingStartup = true
  let startupNavigation = 0
  page.on('websocket', socket => {
    socket.on('framesent', event => {
      if (!observingStartup || typeof event.payload !== 'string') return
      try {
        const envelope = JSON.parse(event.payload)
        if (envelope.type === 'request') rpcPending.set(envelope.id, { channel: envelope.channel, startedMs: performance.now() - started,
          navigation: startupNavigation, resourceKey: envelope.channel === 'workspace:readImage' ? JSON.stringify(envelope.args?.slice(0, 2)) : undefined })
      } catch { /* Non-JSON or binary frame is not an RPC metadata sample. */ }
    })
    socket.on('framereceived', event => {
      wsFrames++; wsBytes += typeof event.payload === 'string' ? Buffer.byteLength(event.payload) : event.payload.length
      if (!observingStartup || typeof event.payload !== 'string') return
      try {
        const envelope = JSON.parse(event.payload), pending = rpcPending.get(envelope.id)
        if (pending && ['response', 'error'].includes(envelope.type)) {
          startupRpc.push({ ...pending, elapsedMs: performance.now() - started - pending.startedMs,
            resultKind: pending.resourceKey ? (envelope.type === 'error' ? 'error' : envelope.result ? 'image' : 'missing') : undefined }); rpcPending.delete(envelope.id)
        }
      } catch { /* Never persist request arguments or response content. */ }
    })
  })
  await page.addInitScript(() => {
    const state = { longTasks: [] as number[], frameGaps: [] as number[], lastFrame: 0 }
    Object.assign(window, { __perf: state })
    new PerformanceObserver(list => { for (const entry of list.getEntries()) state.longTasks.push(entry.duration) }).observe({ type: 'longtask', buffered: true })
    function frame(now: number) { if (state.lastFrame) state.frameGaps.push(now - state.lastFrame); state.lastFrame = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  async function sample() {
    const [perf, dom, backend] = await Promise.all([cdp.send('Performance.getMetrics'), cdp.send('Memory.getDOMCounters'), control('metrics')])
    return { atMs: performance.now() - started, renderer: Object.fromEntries(perf.metrics.map(m => [m.name, m.value])), dom, backend, wsBytes, wsFrames }
  }
  console.log(`[performance] ${profile}: browser startup`)
  const startupOnly = process.argv.includes('--startup-only')
  if (startupOnly) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
  const startupMs: number[] = []
  const navigationResources = []
  for (let i = 0; i < 2; i++) {
    startupNavigation = i
    const start = performance.now()
    await page.goto(origin + '/?route=allSessions/session/perf-000', { waitUntil: 'domcontentloaded' })
    await page.getByText('PERF_END_perf-000', { exact: true }).waitFor({ state: 'visible' })
    await frames()
    startupMs.push(performance.now() - start)
    navigationResources.push(await page.evaluate(() => ({
      navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
      resources: performance.getEntriesByType('resource').map(entry => {
        const resource = entry as PerformanceResourceTiming
        return { path: new URL(resource.name).pathname, kind: resource.initiatorType, startTime: resource.startTime,
          duration: resource.duration, transferSize: resource.transferSize, encodedBodySize: resource.encodedBodySize }
      }),
    })))
  }
  observingStartup = false; rpcPending.clear()
  report.navigationStartup = { firstNavigationMs: startupMs[0], secondNavigationMs: startupMs[1], resources: navigationResources, rpc: startupRpc, after: await sample() }
  report.startupHandlerTimings = await control('handler-timings')
  if (startupOnly) {
    const profile = await cdp.send('Profiler.stop')
    writeFileSync(output.replace(/\.json$/, '') + '.cpu.json', JSON.stringify(profile))
    report.status = 'diagnostic'; report.diagnosticOnly = true
  }
  const imageReads = startupRpc.filter(rpc => rpc.resultKind === 'image')
  const imageReadCounts = new Map<string, number>()
  for (const rpc of imageReads) {
    const key = JSON.stringify([rpc.navigation, rpc.resourceKey])
    imageReadCounts.set(key, (imageReadCounts.get(key) ?? 0) + 1)
  }
  report.startupIcons = { totalReads: startupRpc.filter(rpc => rpc.resourceKey).length, successfulReads: imageReads.length,
    distinctSuccessfulFilesPerNavigation: imageReadCounts.size, maximumSuccessfulFileReads: Math.max(0, ...imageReadCounts.values()) }
  assert([...imageReadCounts.values()].every(count => count <= 1), 'Startup repeated a successful read of the same workspace icon')
  const iconlessSkills: string[] = await page.evaluate(async () => {
    const skills = await (window as any).electronAPI.getSkills('performance-workspace')
    return skills.filter((skill: any) => !skill.iconPath && !skill.metadata?.icon).map((skill: any) => skill.slug)
  })
  const absentSkillProbes = startupRpc.filter(rpc => rpc.resourceKey && iconlessSkills.some(slug =>
    (JSON.parse(rpc.resourceKey!)[1] as string).startsWith(`skills/${slug}/`)))
  report.resolvedSkillIcons = { iconlessSkills: iconlessSkills.length, unexpectedProbes: absentSkillProbes.length }
  assert.equal(absentSkillProbes.length, 0, 'Startup rediscovered files for skills already resolved without icons by the host')
  if (!startupOnly) {
  async function select(id: string) {
    // Exercise the actual SessionItem mouse-down handler; exclude Playwright's
    // actionability polling/animation delay from the timestamp.
    const row = page!.locator(`[data-session-id="${id}"] button`).first()
    await row.waitFor({ state: 'attached' })
    await row.dispatchEvent('mousedown', { button: 0 })
    await page!.getByText(`PERF_END_${id}`, { exact: true }).waitFor({ state: 'visible' })
    await frames()
  }
  const loads = []
  for (const session of ready.sessions.slice(0, 3)) {
    console.log(`[performance] ${session.messageCount} messages: load and warm switches`)
    await select('perf-003')
    const before = await sample()
    const start = performance.now(); await select(session.id); const firstMs = performance.now() - start
    const first = await sample()
    const warmMs: number[] = []
    for (let i = 0; i < options.repeats; i++) {
      await select('perf-003')
      const start = performance.now(); await select(session.id); warmMs.push(performance.now() - start)
    }
    loads.push({ ...session, firstVisitMs: firstMs, warmSwitchMs: warmMs, before, first, after: await sample() })
  }
  report.sessionLoads = loads
  console.log('[performance] longest history: input, copy, search and quoted text')
  const input = page.locator('[contenteditable="true"]').first()
  await input.waitFor({ state: 'visible' }); await input.click()
  const inputSamples: number[] = []
  for (let i = 0; i < 3; i++) {
    const start = performance.now(); await page.keyboard.insertText(`中文输入${i}`); await frames(); inputSamples.push(performance.now() - start)
  }
  assert((await input.innerText()).includes('中文输入0中文输入1中文输入2'))
  await input.fill('')
  await page.getByRole('button', { name: 'Copy', exact: true }).last().click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert(copied.includes('PERF_END_perf-002') && copied.includes(`count: ${options.sizes[2] - 1}`), 'Copy lost the final response or code block')
  await page.keyboard.press('Control+f')
  const search = page.getByPlaceholder('Search titles and content...')
  await search.fill('PERF_END_perf-002')
  await page.getByText('PERF_END_perf-002', { exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => ((CSS as any).highlights?.get('search-active')?.size ?? 0) + ((CSS as any).highlights?.get('search-passive')?.size ?? 0) > 0)
  const quoted = await page.getByText('PERF_END_perf-002', { exact: true }).evaluate(element => {
    const box = element.getBoundingClientRect()
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: box.x + 4, clientY: box.y + 4 }))
    const range = document.createRange(); range.selectNodeContents(element)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    const text = selection.toString()
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: box.x + 4, clientY: box.y + 4 }))
    return text
  })
  assert.equal(quoted, 'PERF_END_perf-002', 'Message reference selection lost text')
  const island = page.locator('[data-ca-annotation-island="true"]')
  await island.getByRole('button', { name: 'Follow-up', exact: true }).click()
  await island.getByPlaceholder('Add comments the agent should consider in the next turn…').fill('保留这段引用，稍后核查')
  await island.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(async () => {
    const session = await (window as any).electronAPI.getSessionMessages('perf-002')
    return JSON.stringify(session.messages).includes('保留这段引用，稍后核查')
  })
  const reference = await page.evaluate(async () => {
    const session = await (window as any).electronAPI.getSessionMessages('perf-002')
    return session.messages.find((message: any) => (JSON.stringify(message.annotations) ?? '').includes('保留这段引用，稍后核查'))?.annotations
  })
  assert(JSON.stringify(reference).includes(quoted), 'Saved reference lost the selected quote')
  await page.getByTitle('Close search').click()
  report.interactions = { inputSamples, copiedBytes: Buffer.byteLength(copied), copiedFinalResponse: true, searchedFinalMessage: true, quoted, reference }
  await page.screenshot({ path: output.replace(/\.json$/, '') + '.history.png' })
  console.log('[performance] 50 deltas/second on the longest conversation')
  await page.evaluate(() => { const state = (window as any).__perf; state.longTasks = []; state.frameGaps = [] })
  const streamBefore = await sample()
  const streamStart = performance.now()
  await control('stream', 'perf-002')
  await page.getByText('PERF_STREAM_FIRST', { exact: false }).first().waitFor({ state: 'visible' })
  await frames()
  const firstFrameMs = performance.now() - streamStart
  await page.getByText('PERF_STREAM_DONE', { exact: false }).first().waitFor({ state: 'visible' })
  await frames()
  assert.equal(await page.getByText('PERF_STREAM_DONE', { exact: false }).count(), 1, 'Live stream produced duplicate responses')
  assert.equal(await page.locator('[data-search-root="response"]').getByText('PERF_END_perf-002', { exact: true }).count(), 1, 'Live stream overwrote or duplicated the prior response')
  const historyCount = await page.evaluate(async () => {
    const session = await (window as any).electronAPI.getSessionMessages('perf-002')
    return session.messages.filter((message: any) => message.role === 'assistant' && message.content.includes('PERF_END_perf-002')).length
  })
  assert.equal(historyCount, 1, 'Host persistence duplicated prior history')
  report.streaming = { firstFrameMs, completeFrameMs: performance.now() - streamStart,
    browserTiming: await page.evaluate(() => (window as any).__perf), before: streamBefore, after: await sample() }
  console.log(`[performance] ${options.sessions} backend histories, ${options.soakSeconds}s real idle, accelerated eviction`)
  report.retention = { beforeLoad: await control('metrics'), afterLoad: await control('load-all'),
    afterAdvancedClockSweep: await control('evict') }
  const soak = []
  for (let seconds = 0; seconds < options.soakSeconds; seconds += 3) {
    await new Promise(resolveWait => setTimeout(resolveWait, Math.min(3, options.soakSeconds - seconds) * 1000))
    soak.push(await sample())
  }
  report.idleSamples = soak
  console.log('[performance] atomic JSONL barriers, synchronous reads, SQLite commits and backup')
  report.persistence = await control('persistence')
  console.log('[performance] Pi distribution process and lazy SDK initialization (offline)')
  report.piStartup = await measurePiStartup(scratch, environment, options.repeats)
  console.log('[performance] shared task facts across real RPC, table and calendar')
  const day = new Date().toLocaleDateString('en-CA')
  const planning = await page.evaluate(async day => {
    const api = (window as any).electronAPI, workspaceId = 'performance-workspace'
    const item = await api.createWorkItem(workspaceId, { title: 'FACT_SHARED_中文', statusId: 'todo', startAt: day, dueAt: day, progress: 25 })
    await api.updateWorkItem(workspaceId, item.id, { title: 'FACT_SHARED_已完成', statusId: 'done', progress: 100 })
    const [items, calendar, session] = await Promise.all([api.listWorkItems(workspaceId), api.listCalendarEntries(workspaceId), api.getSessionMessages(item.id)])
    return { item: items.find((r: any) => r.id === item.id), calendar: calendar.find((r: any) => r.id === item.id), session: { id: session.id, name: session.name, sessionStatus: session.sessionStatus, startAt: session.startAt, dueAt: session.dueAt, progress: session.progress } }
  }, day)
  assert.equal(planning.item.title, planning.session.name); assert.equal(planning.item.title, planning.calendar.title)
  assert.equal(planning.item.statusId, planning.session.sessionStatus); assert.equal(planning.item.statusId, 'done')
  assert.equal(planning.item.progress, 100); assert.equal(planning.session.progress, 100)
  assert.equal(planning.calendar.date, planning.item.startAt); assert.equal(planning.calendar.endDate, planning.item.dueAt)
  await page.goto(origin + '/?route=projects/list', { waitUntil: 'domcontentloaded' })
  const factRow = page.getByRole('button').filter({ has: page.getByText('FACT_SHARED_已完成', { exact: true }) })
  await factRow.waitFor({ state: 'visible' })
  assert((await factRow.innerText()).includes('Done'), 'Table did not show the canonical completed status')
  await page.screenshot({ path: output.replace(/\.json$/, '') + '.table.png' })
  await page.goto(origin + '/?route=calendar', { waitUntil: 'domcontentloaded' })
  await page.locator(`[data-calendar-entry="${planning.item.id}"]`).getByText('FACT_SHARED_已完成', { exact: true }).waitFor({ state: 'visible' })
  await page.screenshot({ path: output.replace(/\.json$/, '') + '.calendar.png' })
  report.planning = planning
  const lastSample: any = (report.streaming as any).after
  const budgetChecks = [
    { id: 'navigation', pass: startupMs.every(ms => ms <= budgets.navigationMs), samples: startupMs, limit: budgets.navigationMs },
    { id: 'firstVisit', pass: loads.every(load => load.firstVisitMs <= budgets.coldSessionMs), samples: loads.map(load => load.firstVisitMs), limit: budgets.coldSessionMs },
    { id: 'warmSwitch', pass: loads.every(load => load.warmSwitchMs.every(ms => ms <= budgets.warmSwitchMs)), samples: loads.flatMap(load => load.warmSwitchMs), limit: budgets.warmSwitchMs },
    { id: 'inputTwoFrames', pass: inputSamples.every(ms => ms <= budgets.inputToTwoFramesMs), samples: inputSamples, limit: budgets.inputToTwoFramesMs },
    { id: 'firstStreamTwoFrames', pass: firstFrameMs <= budgets.firstStreamMs, samples: [firstFrameMs], limit: budgets.firstStreamMs },
    { id: 'rendererHeapBytes', pass: lastSample.renderer.JSHeapUsedSize <= budgets.rendererHeapBytes, samples: [lastSample.renderer.JSHeapUsedSize], limit: budgets.rendererHeapBytes },
    { id: 'backendRssBytes', pass: lastSample.backend.memory.rss <= budgets.backendRssBytes, samples: [lastSample.backend.memory.rss], limit: budgets.backendRssBytes },
  ]
  report.budgetChecks = budgetChecks
  const failedBudgets = budgetChecks.filter(check => !check.pass)
  report.budgetStatus = failedBudgets.length ? 'failed' : 'passed'
  report.browserErrors = pageErrors
  report.blockedExternalRequestCount = blockedRequests.length
  assert.equal(failedBudgets.length, 0, `Local budgets exceeded: ${failedBudgets.map(check => check.id).join(', ')}`)
  if (pageErrors.length) throw new Error(`Production UI errors: ${pageErrors.join('; ')}`)
  if (server.exitCode != null) throw new Error(`Server exited unexpectedly: ${server.exitCode}`)
  report.status = 'passed'
  }
} catch (error) {
  report.status = 'failed'; report.error = String(error)
  if (page) { await page.screenshot({ path: output.replace(/\.json$/, '') + '.failure.png' }).catch(() => {}); report.failureBody = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000) }
  throw error
} finally {
  await browser?.close()
  const stopped = new Promise<void>(resolveStop => server.once('exit', () => resolveStop()))
  if (server.exitCode == null) {
    server.kill('SIGTERM')
    await Promise.race([stopped, new Promise(resolveWait => setTimeout(resolveWait, 5000))])
    if (server.exitCode == null) { server.kill('SIGKILL'); await stopped }
  }
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  writeFileSync(output.replace(/\.json$/, '') + '.server.log', serverLog.join('\n') + '\n')
  assert(dirname(resolve(scratch)) === resolve(tmpdir()) && basename(scratch).startsWith('craft-performance-'), 'Refuse cleanup outside the allocated performance scratch root')
  rmSync(scratch, { recursive: true, force: true })
  console.log(`[performance] ${report.status}: ${output}`)
}

/** Actual Electron main/preload/built-renderer acceptance with a disposable profile.
 * --app=<unpacked directory> runs an existing build.
 * --stage-from=<unpacked directory> copies its runtime/resources to a fresh directory
 * and overlays the current main/preload/renderer bundles; no installer is produced.
 */
import { strict as assert } from 'node:assert'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const root = resolve(import.meta.dir, '../..')
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const output = resolve(arg('output') ?? join(root, '.cache/session-decisions/packaged'))
mkdirSync(output, { recursive: true })
const stagedFrom = arg('stage-from') && resolve(arg('stage-from')!)
let app = resolve(arg('app') ?? join(root, 'apps/electron/release/win-unpacked'))
const bundles: Record<string, string> = {}
if (stagedFrom) {
  assert.equal(process.platform, 'win32', 'Runtime staging currently targets Windows')
  app = mkdtempSync(join(output, 'runtime-'))
  cpSync(stagedFrom, app, { recursive: true })
  const dist = join(app, 'resources/app/dist')
  for (const file of ['main.cjs', 'bootstrap-preload.cjs', 'browser-toolbar-preload.cjs']) {
    const source = join(root, 'apps/electron/dist', file)
    copyFileSync(source, join(dist, file))
    bundles[file] = createHash('sha256').update(readFileSync(source)).digest('hex')
  }
  cpSync(join(root, 'apps/electron/dist/renderer'), join(dist, 'renderer'), { recursive: true })
  bundles['renderer/index.html'] = createHash('sha256').update(readFileSync(join(dist, 'renderer/index.html'))).digest('hex')
  const guide = join(root, 'apps/electron/resources/docs/decisions.md')
  copyFileSync(guide, join(dist, 'resources/docs/decisions.md'))
  bundles['resources/docs/decisions.md'] = createHash('sha256').update(readFileSync(guide)).digest('hex')
}

const fixture = mkdtempSync(join(output, 'profile-')), workspaceRoot = join(fixture, 'workspace')
mkdirSync(workspaceRoot, { recursive: true }); mkdirSync(join(fixture, 'permissions'), { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(fixture, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = fixture
let providerRequests = 0
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  if (req.method === 'GET' && new URL(req.url).pathname === '/health') return Response.json({ status: 'ok', loaded: ['fixture'], device: 'fixture' })
  const body = await req.json() as any; providerRequests++
  return Response.json({ model: 'fixture', answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'noul', noul: .95 }])),
    usage: { input_tokens: 7, output_tokens: 3, cost_usd: .001 } })
} })
const workspace = { id: 'packaged-decisions', name: 'Decision acceptance', rootPath: workspaceRoot, createdAt: Date.now() }
writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ id: workspace.id, name: workspace.name, defaults: { permissionMode: 'ask' } }))
writeFileSync(join(fixture, 'config.json'), JSON.stringify({ setupDeferred: true, workspaces: [workspace], activeWorkspaceId: workspace.id,
  themeMode: 'light', colorTheme: 'default', decisionLayer: { enabled: true, provider: 'custom', baseUrl: provider.url.href, model: 'fixture', features: { riskBadges: true } } }))
const { createSession } = await import('../../packages/shared/src/sessions/storage')
const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
const { openDecisionPoint, recordDecisionOutcome } = await import('../../packages/server-core/src/decisions/decision-point')
const { getDecisionRecorder } = await import('../../packages/shared/src/decisions')
const stored = await createSession(workspaceRoot, { name: 'Decision acceptance A', permissionMode: 'ask' })
const other = await createSession(workspaceRoot, { name: 'Decision acceptance B', permissionMode: 'ask' })
const manager = new SessionManager() as any
manager.sessions.set(stored.id, createManagedSession(stored, workspace as any, { messagesLoaded: true }))
manager.sessions.set(other.id, createManagedSession(other, workspace as any, { messagesLoaded: true }))
const decide = (await openDecisionPoint({ feature: 'riskBadges', record: 'risk_badges', sessionId: stored.id,
  source: { runOperationId: 'fixture-execution' } }))!
const answer = await decide({ state: 'Disposable acceptance input', questions: { sends: { type: 'noul', instructions: 'Does this send a message?' } } })
assert(answer)
recordDecisionOutcome(answer, { action: 'badges', changed: true })
decide.trace!.apply({ action: 'badges', status: 'applied', changed: true, detail: { count: 1 } })
const expected = await manager.getSessionDecisions(stored.id)
assert.equal(expected.totals.points, 1); assert.equal(expected.totals.knownCostUsd, .001)
await getDecisionRecorder().flush(); manager.cleanup()

const checks: any[] = [], errors: string[] = []
async function check(id: string, action: () => Promise<void>) {
  try { await action(); checks.push({ id, pass: true }) }
  catch (error) { checks.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }); console.error(checks.at(-1).error) }
  console.log(`${checks.at(-1).pass ? 'PASS' : 'FAIL'} ${id}`)
}
const env: NodeJS.ProcessEnv = { ...process.env, PHANERIS_CONFIG_DIR: fixture, PHANERIS_WORKSPACE_ID: workspace.id }
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
let application: Awaited<ReturnType<typeof _electron.launch>> | undefined
try {
  application = await _electron.launch({ executablePath: process.platform === 'win32' ? join(app, 'Phaneris.exe') : join(app, 'Contents/MacOS/Phaneris'),
    args: ['--disable-gpu'], env, timeout: 60000 })
  const page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof (window as any).electronAPI?.getSessionDecisions === 'function')
  const route = async (value: string) => page.evaluate(route => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route }, bubbles: true })), value)
  const zh = (await import('../../packages/shared/src/i18n/locales/zh-Hans.json')).default as Record<string, string>
  const en = (await import('../../packages/shared/src/i18n/locales/en.json')).default as Record<string, string>
  await page.waitForTimeout(1500)
  const language = await page.evaluate(() => localStorage.getItem('i18nextLng'))
  const messages = language?.includes('zh') ? zh : en
  await check('Actual preload and authenticated main return the persisted session report', async () => {
    const value = await page.evaluate(id => (window as any).electronAPI.getSessionDecisions(id), stored.id)
    assert.equal(value.workspaceId, workspace.id); assert.deepEqual(value.totals, expected.totals)
    assert.equal(value.items[0].application.status, 'applied'); assert.equal(providerRequests, 1)
    writeFileSync(join(output, 'report.json'), JSON.stringify(value, null, 2))
  })
  await check('Packaged Run renders Decisions for a session with no chat messages', async () => {
    await route(`allSessions/session/${stored.id}`); await page.waitForTimeout(500); await route('trajectory')
    await page.getByRole('tab', { name: messages['trajectory.views.decisions'], exact: true }).click()
    await page.locator(`[data-decision-id="${decide.trace!.decisionPointId}"]`).waitFor()
    assert.equal(await page.locator('[data-session-decisions]').getAttribute('data-session-decisions'), stored.id)
    // Selecting a record opens the detail drawer; the record list stays mounted.
    await page.locator(`[data-decision-id="${decide.trace!.decisionPointId}"]`).click()
    await page.locator('[data-decision-detail]').waitFor()
    assert((await page.locator('[data-decision-detail]').innerText()).includes(messages['trajectory.decisions.application']))
    assert.equal(await page.locator(`[data-decision-id="${decide.trace!.decisionPointId}"]`).count(), 1)
    if (!process.env.PHANERIS_VERIFY_SKIP_SCREENSHOTS) await page.screenshot({ path: join(output, 'run-decisions.png') })
  })
  await check('Changing the active chat updates the session-bound Decisions range', async () => {
    await route(`allSessions/session/${other.id}`); await route('trajectory')
    await page.getByText(messages['trajectory.decisions.empty'], { exact: true }).waitFor()
    assert.equal(await page.locator('[data-session-decisions]').getAttribute('data-session-decisions'), other.id)
  })
  await check('Packaged AI settings show configuration without runtime statistics', async () => {
    await route('settings/ai'); await page.locator('[data-ai-advanced="decisions"] [data-ai-advanced-toggle]').click()
    await page.locator('[data-decision-settings]').waitFor()
    assert.equal(await page.locator('[data-decision-usage]').count(), 0)
    assert((await page.locator('[data-decision-settings]').innerText()).includes(messages['settings.ai.decisions.runHint']))
    await page.locator('[data-decision-settings]').scrollIntoViewIfNeeded()
    if (!process.env.PHANERIS_VERIFY_SKIP_SCREENSHOTS) await page.screenshot({ path: join(output, 'ai-settings.png') })
  })
  await check('Packaged Permissions retain their rules without the Guarded redirect', async () => {
    await route('settings/permissions'); await page.waitForTimeout(1000)
    assert.equal(await page.getByRole('heading', { name: /Guarded/, exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /Decision assistance|决策辅助/, exact: true }).count(), 0)
    assert.equal(await page.locator('[data-decision-settings]').count(), 0)
    assert((await page.locator('body').innerText()).includes(messages['settings.permissions.aboutPermissions']))
    if (!process.env.PHANERIS_VERIFY_SKIP_SCREENSHOTS) await page.screenshot({ path: join(output, 'permissions.png') })
  })
  assert.equal(providerRequests, 1, 'Reading and navigating must not call the decision provider')
} catch (error) { checks.push({ id: 'packaged launch and page setup', pass: false, error: error instanceof Error ? error.stack : String(error) }) }
finally {
  await application?.close().catch(() => {}); provider.stop(true)
  writeFileSync(join(output, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), app, stagedFrom, bundles,
    scope: stagedFrom ? 'Existing unpacked runtime/resources with freshly built worktree bundles; installer not verified' : 'Supplied unpacked app',
    fixture, sessionId: stored.id, providerRequests, checks, errors }, null, 2) + '\n')
}
console.log(JSON.stringify({ output, passed: checks.filter(check => check.pass).length, total: checks.length, errors }))
process.exit(checks.every(check => check.pass) && errors.length === 0 ? 0 : 1)

/**
 * B5 packaged E2E. Failure conditions were written in the Pi 1.1.0 failure matrix
 * before implementation: missing RPC, stale renderer, misleading cost/disabled
 * states, inaccessible labels, overflow, lost settings and runtime startup failure.
 * Uses the shipped app, a disposable profile, synthetic logs and a loopback provider.
 */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { _electron } from 'playwright'

const root = resolve(import.meta.dir, '../..')
const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3)
const app = resolve(arg('app') ?? join(root, 'apps/electron/release/win-unpacked'))
const output = resolve(arg('output') ?? join(root, '.cache/pi-110-implementation/packaged-ui'))
mkdirSync(output, { recursive: true })
const fixture = mkdtempSync(join(output, 'profile-')), workspace = join(fixture, 'workspace')
mkdirSync(workspace); mkdirSync(join(fixture, 'logs'))
process.env.PHANERIS_CONFIG_DIR = fixture
const longLabel = 'Pi SDK 1.1.0 / Craft 0.14.1 验证标签与完整名称 ' + 'Long verification label '.repeat(5)
mkdirSync(join(workspace, 'labels'))
writeFileSync(join(workspace, 'labels/config.json'), JSON.stringify({ version: 1, labels: [{ id: 'long', name: longLabel, color: 'accent' }] }))
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
  const pathname = new URL(req.url).pathname
  return pathname.endsWith('/models') ? Response.json({ data: [{ id: 'gpt-5.4', object: 'model', owned_by: 'fixture' }] })
    : Response.json({ status: 'ok', loaded: ['fixture'] })
} })
writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'pi-110-ui', name: 'Verification',
  defaults: { model: 'gpt-5.4', thinkingLevel: 'medium', permissionMode: 'ask' } }))
writeFileSync(join(fixture, 'config.json'), JSON.stringify({ setupDeferred: true,
  workspaces: [{ id: 'pi-110-ui', name: 'Verification', rootPath: workspace, createdAt: Date.now() }],
  activeWorkspaceId: 'pi-110-ui', colorTheme: 'default', themeMode: 'light', defaultLlmConnection: 'openai',
  llmConnections: [{ slug: 'openai', name: 'OpenAI fixture', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key',
    baseUrl: provider.url.href + 'v1', defaultModel: 'gpt-5.4', models: ['gpt-5.4'], modelFetchInterval: 1440 }],
  decisionLayer: { enabled: true, provider: 'custom', baseUrl: provider.url.href, model: 'fixture',
    features: { adaptiveThinking: true, largeResults: true, turnOutcome: true, suggestions: false, guardedMode: false } } }))
const t = new Date().toISOString(), logs: unknown[] = []
for (let i = 0; i < 30; i++) {
  logs.push({ id: `thinking-${i}`, t, feature: 'adaptive_thinking', provider: 'custom', model: 'fixture', ok: true,
    latencyMs: 10, questions: {}, state: null, usage: { inputTokens: 5, outputTokens: 1, costUsd: 0 } })
  logs.push({ kind: 'outcome', decisionId: `thinking-${i}`, t, feature: 'adaptive_thinking', action: 'thinking:medium', changed: false })
}
logs.push({ id: 'large-1', t, feature: 'large_results', provider: 'custom', model: 'fixture', ok: true, coldStart: true,
  latencyMs: 20, questions: {}, state: null, usage: { inputTokens: 10, outputTokens: 2, costUsd: .001 } },
  { kind: 'outcome', decisionId: 'large-1', t, feature: 'large_results', action: 'filter', changed: true },
  { kind: 'followup', decisionId: 'large-1', t, feature: 'large_results', result: 'file_access_attempted' },
  { id: 'large-2', t, feature: 'large_results', provider: 'custom', model: 'fixture', ok: false, coldStart: true,
    questions: {}, state: null, error: { kind: 'cancelled', message: 'Fixture cancellation' } })
writeFileSync(join(fixture, 'logs/decisions.jsonl'), logs.map(line => JSON.stringify(line)).join('\n') + '\n')
const { getCredentialManager } = await import('../../packages/shared/src/credentials')
await getCredentialManager().setLlmApiKey('openai', 'pi-110-packaged-fixture-key')
const executable = process.platform === 'win32' ? join(app, 'Phaneris.exe') : join(app, 'Contents/MacOS/Phaneris')
const env: NodeJS.ProcessEnv = { ...process.env, PHANERIS_CONFIG_DIR: fixture, PHANERIS_WORKSPACE_ID: 'pi-110-ui' }
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
const records: Array<{ id: string; pass: boolean; observation?: unknown; error?: string }> = [], errors: string[] = []
const measurements: Record<string, unknown> = {}, screenshots: string[] = []
let application: Awaited<ReturnType<typeof _electron.launch>> | undefined
async function check(id: string, action: () => unknown | Promise<unknown>) {
  try { records.push({ id, pass: true, observation: await action() }) }
  catch (error) { records.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }) }
}
try {
  const started = performance.now()
  application = await _electron.launch({ executablePath: executable, args: ['--disable-gpu'], env, timeout: 90_000 })
  const page = await application.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof (window as any).electronAPI?.getDecisionUsage === 'function')
  await page.locator('.sidebar-new-session').waitFor()
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  measurements.launchToReadyMs = performance.now() - started
  // Force the test language through the same persisted preference used by the app.
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'))
  await page.reload(); await page.locator('.sidebar-new-session').waitFor()
  const navigate = (subpage: string) => page.evaluate(subpage => window.dispatchEvent(new CustomEvent('phaneris-navigate',
    { detail: { route: `settings/${subpage}` }, bubbles: true })), subpage)
  await check('The actual packaged window, preload and authenticated usage RPC are available', async () => {
    const usage: any = await page.evaluate(() => (window as any).electronAPI.getDecisionUsage())
    assert.equal(usage.features.adaptiveThinking.calls, 30); assert.equal(usage.features.adaptiveThinking.changed, 0)
    assert.equal(usage.features.largeResults.calls, 2); assert.equal(usage.features.largeResults.failures, 1)
    assert.equal(usage.features.largeResults.knownCostUsd, .001); assert.equal(usage.features.largeResults.unknownCostCalls, 1)
    assert.equal(usage.features.largeResults.followUps.file_access_attempted, 1)
    assert(!JSON.stringify(usage).includes('pi-110-packaged-fixture-key'))
    return usage
  })
  await check('AI settings keep the existing single-page structure and collapsed disclosure', async () => {
    const started = performance.now(); await navigate('ai'); await page.locator('#context-policy-select').waitFor()
    measurements.aiSettingsNavigationMs = performance.now() - started
    assert.equal(await page.getByRole('tablist').count(), 0)
    assert.equal(await page.locator('[data-decision-settings] [data-ai-advanced-toggle]').getAttribute('aria-expanded'), 'false')
    assert.equal(await page.locator('[data-decision-usage]').count(), 0)
    await page.locator('[data-decision-settings] [data-ai-advanced-toggle]').click()
    await page.locator('[data-decision-usage="adaptiveThinking"]').waitFor()
  })
  await check('Feature rows expose real counts, known and unknown cost, with accessible descriptions', async () => {
    const thinking = page.locator('[data-decision-usage="adaptiveThinking"]')
    assert((await thinking.innerText()).includes('30')); assert.equal(await thinking.locator('p').count(), 3)
    const row = page.locator('[data-layout="settings-row"]').filter({ has: thinking })
    const described = await row.getByRole('switch').getAttribute('aria-describedby')
    assert(described?.includes('-description') && described.includes('-note'))
    assert((await page.locator('[data-decision-settings]').innerText()).includes('attachment metadata'))
    assert((await page.locator('[data-decision-usage="largeResults"]').innerText()).includes('1'))
    return { thinking: await thinking.innerText(), largeResults: await page.locator('[data-decision-usage="largeResults"]').innerText() }
  })
  await check('A no-change observation never disables a feature, and toggles persist through real RPC', async () => {
    const before: any = await page.evaluate(() => (window as any).electronAPI.getDecisionLayerSettings())
    assert.equal(before.features.adaptiveThinking, true)
    await page.evaluate(() => (window as any).electronAPI.setDecisionLayerSettings({ features: { largeResults: false } }))
    const after: any = await page.evaluate(() => (window as any).electronAPI.getDecisionLayerSettings())
    assert.equal(after.features.largeResults, false); assert.equal(after.features.adaptiveThinking, true)
    await navigate('appearance'); await page.locator('#context-policy-select').waitFor({ state: 'detached' }); await navigate('ai')
    await page.locator('[data-decision-settings] [data-ai-advanced-toggle]').click()
    await page.locator('[data-decision-usage="largeResults"]').waitFor()
    assert.equal(await page.locator('[data-layout="settings-row"]').filter({ has: page.locator('[data-decision-usage="largeResults"]') }).getByRole('switch').getAttribute('aria-checked'), 'false')
  })
  await check('Expanded sidebar labels retain their complete title while long names truncate', async () => {
    const labelsGroup = page.locator('.sidebar-label[title="Labels"]').locator('xpath=..')
    await labelsGroup.hover()
    await labelsGroup.locator('[data-no-dnd][data-touch-reveal]').click()
    const label = page.locator('.sidebar-label').filter({ hasText: longLabel })
    await label.waitFor()
    assert.equal(await label.getAttribute('title'), longLabel)
    const dimensions = await label.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth,
      whiteSpace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).textOverflow,
      display: getComputedStyle(element).display, width: element.getBoundingClientRect().width, html: element.outerHTML }))
    assert(dimensions.scroll > dimensions.client, JSON.stringify(dimensions)); assert.equal(dimensions.whiteSpace, 'nowrap'); assert.equal(dimensions.overflow, 'ellipsis')
    return dimensions
  })
  // One batched visual pass: wide/light English and narrow/dark Chinese.
  await check('Wide light and narrow dark settings retain readable statistics without horizontal overflow', async () => {
    const photograph = async (name: string) => {
      await page.locator('[data-decision-usage="adaptiveThinking"]').scrollIntoViewIfNeeded()
      if (arg('screenshots') !== 'false') {
        const path = join(output, name); await page.screenshot({ path }); screenshots.push(path)
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      assert(overflow <= 1, `Horizontal overflow: ${overflow}px`)
    }
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 1000))
    await photograph('decisions-en-light-wide.png')
    await navigate('appearance')
    await page.getByRole('radio', { name: 'Dark', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'zh-Hans'))
    await page.reload(); await page.locator('.sidebar-new-session').waitFor()
    await navigate('ai'); await page.locator('#context-policy-select').waitFor()
    await page.locator('[data-decision-settings] [data-ai-advanced-toggle]').click()
    await page.locator('[data-decision-usage="adaptiveThinking"]').waitFor()
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1024, 768))
    await photograph('decisions-zh-dark-narrow.png')
    assert((await page.locator('[data-decision-settings]').innerText()).includes('附件元信息'))
    return { screenshots, dark: true, language: 'zh-Hans' }
  })
  await check('Disabled and no-data states remain distinguishable, and the window has no renderer exception', async () => {
    const text = await page.locator('[data-decision-settings]').innerText()
    const locale = JSON.parse(readFileSync(join(root, 'packages/shared/src/i18n/locales/zh-Hans.json'), 'utf8'))
    assert(text.includes(locale['settings.ai.decisions.usageDisabled'])); assert(text.includes(locale['settings.ai.decisions.usageNone']))
    assert.equal(errors.length, 0)
    return { errors }
  })
} catch (error) { records.push({ id: 'packaged startup', pass: false, error: error instanceof Error ? error.stack : String(error) }) }
finally {
  await application?.close(); provider.stop(true)
  const sha256 = createHash('sha256').update(readFileSync(executable)).digest('hex')
  writeFileSync(join(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), app, executable, executableSha256: sha256,
    fixture, scope: 'Actual packaged Electron, renderer, preload, authenticated RPC and local synthetic usage logs; no real provider inference.',
    records, errors, measurements, screenshots }, null, 2) + '\n')
}
console.log(JSON.stringify({ output, passed: records.filter(r => r.pass).length, total: records.length, failures: records.filter(r => !r.pass), errors }))
process.exit(records.every(record => record.pass) && errors.length === 0 ? 0 : 1)

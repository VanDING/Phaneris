/** Actual packaged app shell, renderer and IPC with a disposable profile and loopback provider. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { DEFAULT_THEME_FILE } from '../../packages/shared/src/config/theme'

const root = resolve(import.meta.dir, '../..')
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? join(root, '.cache/ai-settings-refinement'))
mkdirSync(output, { recursive: true })
const fixture = mkdtempSync(join(output, 'packaged-ui-')), workspace = join(fixture, 'workspace')
mkdirSync(workspace)
process.env.PHANERIS_CONFIG_DIR = fixture
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ data: [{ id: 'gpt-5.4', object: 'model', owned_by: 'fixture' }] }) })
writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'packaged-ui', name: 'Verification', defaults: { model: 'gpt-5.4', thinkingLevel: 'medium', permissionMode: 'ask' } }))
writeFileSync(join(fixture, 'config.json'), JSON.stringify({ setupDeferred: true, workspaces: [{ id: 'packaged-ui', name: 'Verification', rootPath: workspace, createdAt: Date.now() }],
  activeWorkspaceId: 'packaged-ui', activeSessionId: null, colorTheme: 'default', themeMode: 'light', defaultLlmConnection: 'openai',
  llmConnections: [{ slug: 'openai', name: 'OpenAI', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key', baseUrl: provider.url.href + 'v1', defaultModel: 'gpt-5.4', models: ['gpt-5.4'], modelFetchInterval: 1440 }] }))
const { getCredentialManager } = await import('../../packages/shared/src/credentials')
await getCredentialManager().setLlmApiKey('openai', 'packaged-fixture-only-key')
const app = process.argv.find(arg => arg.startsWith('--app='))?.slice(6) ?? join(output, 'package/mac/Phaneris.app')
const env: NodeJS.ProcessEnv = { ...process.env, PHANERIS_CONFIG_DIR: fixture, PHANERIS_WORKSPACE_ID: 'packaged-ui' }
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
const records: Array<{ id: string; pass: boolean; error?: string }> = [], errors: string[] = []
let application: Awaited<ReturnType<typeof _electron.launch>> | undefined
async function check(id: string, action: () => Promise<void>) {
  try { await action(); records.push({ id, pass: true }) }
  catch (error) { records.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }) }
}
try {
  application = await _electron.launch({ executablePath: join(app, 'Contents/MacOS/Phaneris'), args: ['--disable-gpu'], env, timeout: 60_000 })
  const page = await application.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof (window as any).electronAPI?.getContextPolicy === 'function')
  await page.waitForTimeout(1500)
  const navigate = (subpage: string) => page.evaluate(subpage => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route: `settings/${subpage}` }, bubbles: true })), subpage)
  await check('Actual packaged app renders AI settings with one page and the standard context control', async () => {
    await navigate('ai')
    await page.locator('#context-policy-select').waitFor({ timeout: 30_000 })
    assert.equal(await page.getByRole('tablist').count(), 0)
    assert.deepEqual(await page.locator('[data-ai-settings-section]').evaluateAll(elements => elements.map(e => e.getAttribute('data-ai-settings-section'))), ['connections', 'conversation', 'advanced'])
    assert.deepEqual(await page.locator('[data-ai-advanced-toggle]').evaluateAll(elements => elements.map(e => e.getAttribute('aria-expanded'))), ['false', 'false', 'false'])
    await page.locator('[data-ai-advanced="images"] [data-ai-advanced-toggle]').click()
    assert.deepEqual(await page.locator('[data-ai-advanced-toggle]').evaluateAll(elements => elements.map(e => e.getAttribute('aria-expanded'))), ['true', 'false', 'false'])
    await page.locator('[data-ai-advanced="images"] [data-ai-advanced-toggle]').click()
    await page.locator('#context-policy-select').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(output, 'packaged-ai-context.png') })
    await page.locator('#context-policy-select').locator('xpath=ancestor::section').screenshot({ path: join(output, 'packaged-context-card.png') })
  })
  await check('Packaged builtin Default uses the approved white card and gray message palette', async () => {
    const result: any = await page.evaluate(() => (window as any).electronAPI.loadPresetTheme('default'))
    assert.deepEqual(result.theme, DEFAULT_THEME_FILE)
    assert.equal(await page.locator('.craft-settings-card').first().evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)')
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return { bubble: style.getPropertyValue('--user-message-bubble').trim(), background: style.getPropertyValue('--background').trim() }
    })
    assert.equal(tokens.bubble.toUpperCase(), '#F3F3F3'); assert.equal(tokens.background, 'rgb(255, 255, 255)')
    const resource = join(app, 'Contents/Resources/app/dist/resources/themes/default.json')
    assert.deepEqual(JSON.parse(readFileSync(resource, 'utf8')), DEFAULT_THEME_FILE)
  })
  await check('New Session uses a white card surface through hover and opens a chat from the keyboard', async () => {
    const button = page.locator('.sidebar-new-session')
    await page.mouse.move(0, 0)
    const card = await page.locator('.craft-settings-card').first().evaluate(e => getComputedStyle(e).backgroundColor)
    assert.equal(card, 'rgb(255, 255, 255)')
    assert.equal(await button.evaluate(e => getComputedStyle(e).backgroundColor), card)
    const tokens = await page.evaluate(() => {
      const sample = document.createElement('span'); document.body.append(sample)
      const color = (value: string) => { sample.style.color = value; return getComputedStyle(sample).color }
      const actual = color('var(--accent)'), ring = color('var(--ring)'), expected = color('oklch(0.488 0.275 280.3)')
      sample.remove(); return { actual, ring, expected }
    })
    assert.equal(tokens.actual, tokens.expected); assert.equal(tokens.ring, tokens.expected)
    const restingShadow = await button.evaluate(e => getComputedStyle(e).boxShadow)
    await button.hover(); await page.waitForTimeout(300)
    assert.equal(await button.evaluate(e => getComputedStyle(e).backgroundColor), card)
    assert.notEqual(await button.evaluate(e => getComputedStyle(e).boxShadow), restingShadow)
    await page.screenshot({ path: join(output, 'packaged-sidebar-light-hover.png') })
    await page.mouse.move(0, 0); await button.focus()
    assert.equal(await button.evaluate(e => e === document.activeElement), true)
    await page.keyboard.down('Space')
    assert(await button.evaluate(e => e.matches(':focus-visible')))
    assert.equal(await button.evaluate(e => getComputedStyle(e).outlineWidth), '2px')
    await button.screenshot({ path: join(output, 'packaged-sidebar-light-focus.png') })
    await page.keyboard.up('Space')
    await page.locator('#context-policy-select').waitFor({ state: 'detached' })
    await page.locator('[data-tutorial="chat-input"]').waitFor()
    await page.screenshot({ path: join(output, 'packaged-sidebar-new-chat.png') })
    await navigate('ai'); await page.locator('#context-policy-select').waitFor()
  })
  await check('Packaged appearance controls switch Default to graphite dark mode and restore light mode', async () => {
    await navigate('appearance')
    await page.getByRole('radio', { name: /^(Dark|深色)$/ }).click()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    await navigate('ai')
    await page.locator('#context-policy-select').waitFor()
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--user-message-bubble').trim().toLowerCase() === '#2b2b2b')
    await page.waitForFunction(() => {
      const card = document.querySelector('.craft-settings-card')
      return card && getComputedStyle(card).backgroundColor === 'rgb(28, 31, 38)'
    })
    assert.equal(await page.locator('.craft-settings-card').first().evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(28, 31, 38)')
    const button = page.locator('.sidebar-new-session')
    await page.mouse.move(0, 0)
    assert.equal(await button.evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(28, 31, 38)')
    await button.hover(); await page.waitForTimeout(300)
    assert.equal(await button.evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(28, 31, 38)')
    const colors = await page.evaluate(() => {
      const sample = document.createElement('span'); document.body.append(sample)
      const color = (value: string) => { sample.style.color = value; return getComputedStyle(sample).color }
      const actual = color('var(--accent)'), ring = color('var(--ring)'), expected = color('oklch(0.626 0.221 291.7)')
      sample.remove(); return { actual, ring, expected }
    })
    assert.equal(colors.actual, colors.expected); assert.equal(colors.ring, colors.expected)
    await page.screenshot({ path: join(output, 'packaged-sidebar-dark-hover.png') })
    await page.mouse.move(0, 0)
    await page.screenshot({ path: join(output, 'packaged-ai-dark.png') })
    await navigate('appearance')
    await page.getByRole('radio', { name: /^(Light|浅色)$/ }).click()
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
    await navigate('ai')
    await page.locator('#context-policy-select').waitFor()
  })
  await check('Packaged image settings RPC persists the dedicated image model and returns its effective choice', async () => {
    const status: any = await page.evaluate(() => (window as any).electronAPI.setImageGenerationSettings({ connectionSlug: 'openai', model: 'gpt-image-1' }))
    assert.equal(status.effective.model, 'gpt-image-1')
    const reloaded: any = await page.evaluate(() => (window as any).electronAPI.getImageGenerationSettings())
    assert.equal(reloaded.settings.model, 'gpt-image-1')
    assert(!JSON.stringify(reloaded).includes('packaged-fixture-only-key'))
    await navigate('appearance')
    await page.locator('#context-policy-select').waitFor({ state: 'detached' })
    await navigate('ai')
    await page.waitForFunction(() => document.querySelector('[data-image-generation-settings]')?.textContent?.includes('gpt-image-1'))
  })
  await check('Packaged permissions page exposes Guarded setup with actual backend readiness', async () => {
    const status: any = await page.evaluate(() => (window as any).electronAPI.getDecisionLayerStatus())
    assert.equal(status.guardedMode.available, false); assert.equal(status.guardedMode.reason, 'disabled')
    await navigate('permissions')
    const guarded = page.getByRole('heading', { name: /^(Guarded|受保护)$/ })
    await guarded.waitFor(); await guarded.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(output, 'packaged-guarded-setup.png') })
    await guarded.locator('xpath=ancestor::section').getByRole('button', { name: /^(Configure decision model|配置决策模型)$/ }).click()
    const decisions = page.locator('[data-decision-settings]')
    await decisions.waitFor()
    assert.equal(await decisions.locator('[data-ai-advanced-toggle]').getAttribute('aria-expanded'), 'true')
  })
} catch (error) { records.push({ id: 'Packaged application startup', pass: false, error: String(error) }) }
finally {
  await application?.close(); provider.stop(true)
  writeFileSync(join(output, 'packaged-latest.json'), JSON.stringify({ app, fixture, records, errors }, null, 2))
}
console.log(JSON.stringify({ records, errors })); process.exit(records.every(record => record.pass) && !errors.length ? 0 : 1)

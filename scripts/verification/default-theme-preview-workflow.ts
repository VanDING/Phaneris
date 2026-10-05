/** Real Default/candidate E2E: isolated storage and actual settings/chat/controls rendering. */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { chromium, type Page } from 'playwright'
import { validateThemeContent } from '../../packages/shared/src/config/validators'
import { BACKGROUND_HEX, DEFAULT_THEME_FILE, isValidUserThemeId, themeToCSS } from '../../packages/shared/src/config/theme'

const root = resolve(import.meta.dir, '../..')
const output = resolve(root, 'docs/design/default-redesign')
const previews = resolve(output, 'previews')
const cache = resolve(root, '.cache/default-theme-preview')
const themePath = resolve(output, 'default-preview.json')
const candidate = JSON.parse(readFileSync(themePath, 'utf8'))
const builtin = process.argv.includes('--builtin')
const selectedTheme = builtin ? 'default' : 'default-preview'
const requestedOutput = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const screenshotDirectory = requestedOutput ? resolve(requestedOutput) : builtin ? resolve(root, 'docs/verification/results/default-theme-application') : previews
const guardedPaths = ['apps/electron/resources/themes/default.json', 'packages/shared/src/config/theme.ts',
  'apps/electron/src/renderer/index.css', 'packages/ui/src/styles/index.css',
  'apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx']
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const before = Object.fromEntries(guardedPaths.map(path => [path, hash(resolve(root, path))]))
mkdirSync(screenshotDirectory, { recursive: true }); mkdirSync(cache, { recursive: true })
const records: Array<{ id: string; pass: boolean; error?: string }> = []
const contrast: unknown[] = [], errors: string[] = [], messageSurfaces: unknown[] = []
async function check(id: string, action: () => Promise<void> | void) {
  try { await action(); records.push({ id, pass: true }) }
  catch (error) { records.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }) }
}
if (builtin) await check('Applied Default matches approved visual tokens, bundled JSON, static CSS and startup backgrounds', () => {
  const { name, description, author, license, supportedModes, shikiTheme, ...approved } = candidate
  const { name: actualName, description: actualDescription, author: actualAuthor, license: actualLicense,
    supportedModes: actualModes, shikiTheme: actualShiki, ...actual } = DEFAULT_THEME_FILE
  assert.equal(actualName, 'Default'); assert.deepEqual(actual, approved)
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'apps/electron/resources/themes/default.json'), 'utf8')), DEFAULT_THEME_FILE)
  assert.deepEqual(BACKGROUND_HEX, { light: DEFAULT_THEME_FILE.background, dark: DEFAULT_THEME_FILE.dark?.background })
  const declarations = (css: string) => new Map([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]))
  for (const path of ['apps/electron/src/renderer/index.css', 'packages/ui/src/styles/index.css']) {
    const css = readFileSync(resolve(root, path), 'utf8')
    const light = declarations(css.match(/:root \{([\s\S]*?)\n\}/)![1]!)
    const dark = new Map([...light, ...declarations(css.match(/\.dark \{([\s\S]*?)\n\}/)![1]!)])
    for (const mode of [false, true]) for (const [key, value] of declarations(themeToCSS(DEFAULT_THEME_FILE, mode)))
      assert.equal((mode ? dark : light).get(key), value, `${path} ${mode ? 'dark' : 'light'} ${key}`)
  }
})
if (builtin) await check('Default preserves its original light/dark purple without changing approved message surfaces', () => {
  assert.equal(DEFAULT_THEME_FILE.accent, 'oklch(0.488 0.275 280.3)')
  assert.equal(DEFAULT_THEME_FILE.ring, DEFAULT_THEME_FILE.accent)
  assert.equal(DEFAULT_THEME_FILE.dark?.accent, 'oklch(0.626 0.221 291.7)')
  assert.equal(DEFAULT_THEME_FILE.dark?.ring, DEFAULT_THEME_FILE.dark?.accent)
  assert.equal(DEFAULT_THEME_FILE.userMessageBubble, '#F3F3F3')
  assert.equal(DEFAULT_THEME_FILE.dark?.userMessageBubble, '#2B2B2B')
})
await check('Product theme schema and non-reserved filename', () => {
  const result = validateThemeContent(readFileSync(themePath, 'utf8'), 'default-preview.json')
  assert(result.valid, JSON.stringify(result.errors)); assert(isValidUserThemeId('default-preview'))
  assert.deepEqual(candidate.supportedModes, ['light', 'dark'])
})
await check('Real theme storage loads, selects and restores in a temporary profile', () => {
  const profile = mkdtempSync(join(tmpdir(), 'phaneris-default-preview-'))
  try {
    mkdirSync(join(profile, 'themes'))
    writeFileSync(join(profile, 'themes/default-preview.json'), JSON.stringify(candidate))
    const personalTheme = '{"name":"Preserved","accent":"#336699"}'
    writeFileSync(join(profile, 'themes/preserved.json'), personalTheme)
    writeFileSync(join(profile, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null }))
    const storage = pathToFileURL(resolve(root, 'packages/shared/src/config/storage.ts')).href
    const probe = Bun.spawnSync([process.execPath, '--eval', `
      import { loadPresetThemes, loadPresetTheme, getThemePreferences, setThemePreferences } from '${storage}';
      const builtin = loadPresetTheme('default');
      const preview = loadPresetTheme('default-preview');
      setThemePreferences({ ...getThemePreferences(), colorTheme: 'default-preview' });
      const selected = getThemePreferences().colorTheme;
      setThemePreferences({ ...getThemePreferences(), colorTheme: 'default' });
      console.log(JSON.stringify({ ids: loadPresetThemes().map(t => t.id), preview, selected,
        restored: getThemePreferences().colorTheme, builtinName: builtin?.theme.name, builtinPath: builtin?.path,
        builtin: builtin?.theme, alias: loadPresetTheme('twilight')?.theme }));
    `], { env: { ...process.env, PHANERIS_CONFIG_DIR: profile }, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(probe.exitCode, 0, probe.stderr.toString())
    const result = JSON.parse(probe.stdout.toString().trim().split('\n').at(-1)!)
    assert(result.ids.includes('default-preview')); assert.deepEqual(result.preview.theme, candidate)
    assert.equal(result.selected, 'default-preview'); assert.equal(result.restored, 'default')
    assert.equal(result.builtinName, 'Default'); assert.equal(result.builtinPath, 'builtin:default')
    if (builtin) { assert.deepEqual(result.builtin, DEFAULT_THEME_FILE); assert.deepEqual(result.alias, DEFAULT_THEME_FILE) }
    assert.equal(readFileSync(join(profile, 'themes/preserved.json'), 'utf8'), personalTheme)
  } finally { rmSync(profile, { recursive: true, force: true }) }
})
writeFileSync(resolve(cache, 'settings.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/default-theme-preview.tsx"></script></body></html>')
const server = await createServer({ configFile: resolve(root, 'apps/electron/vite.config.ts'), root,
  server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/runtimes/**'] } } })
await server.listen()
const address = server.httpServer!.address() as { port: number }
const base = `http://127.0.0.1:${address.port}/.cache/default-theme-preview/settings.html`
const browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL })
const page = await browser.newPage({ viewport: { width: 1040, height: 1580 } })
page.on('pageerror', error => errors.push(error.message))
async function load(mode = 'light', lang = 'en', view = 'ai', theme = selectedTheme) {
  await page.goto(`${base}?mode=${mode}&lang=${lang}&view=${view}&theme=${theme}`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForFunction(id => (id === 'default' ? !document.documentElement.dataset.theme : document.documentElement.dataset.theme === id), theme)
  await page.waitForFunction(() => (window as any).defaultThemePreviewState?.ready === true)
  await page.evaluate(() => document.fonts.ready)
}
async function capture(filename: string) {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(350) // Complete the real controls' finite expansion/focus animations.
  await page.screenshot({ path: resolve(screenshotDirectory, filename) })
}
async function readContrast(target: Page) {
  return target.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!, sample = document.createElement('span')
    document.body.append(sample)
    const color = (token: string) => { sample.style.color = `var(${token})`; return getComputedStyle(sample).color }
    const luminance = (value: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1)
      const c = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(v => {
        const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4
      })
      return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722
    }
    const pairs = ['--foreground', '--muted-foreground', '--foreground-dimmed', '--info', '--info-text', '--success', '--destructive']
      .flatMap(text => ['--background', '--card'].map(surface => ({ text, surface, minimum: 4.5 })))
    // Original brand purple is preserved verbatim by request; record its distinct
    // graphics threshold instead of including it in normal text contrast claims.
    pairs.push(...['--background', '--card'].map(surface => ({ text: '--accent', surface, minimum: 3 })))
    pairs.push({ text: '--popover-foreground', surface: '--popover-solid', minimum: 4.5 },
      { text: '--muted-foreground', surface: '--popover-solid', minimum: 4.5 },
      { text: '--foreground', surface: '--input', minimum: 4.5 },
      { text: '--foreground', surface: '--user-message-bubble', minimum: 4.5 },
      { text: '--background', surface: '--foreground', minimum: 4.5 },
      { text: '--background', surface: '--destructive', minimum: 4.5 },
      { text: '--ring', surface: '--background', minimum: 3 })
    const readings = pairs.map(p => {
      const a = luminance(color(p.text)), b = luminance(color(p.surface))
      return { ...p, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
    })
    sample.remove(); return readings
  })
}
try {
  await check('Baseline screenshot uses the same AI page and connection data', async () => {
    await load('light', 'en', 'ai', 'default')
    await page.locator('[data-ai-advanced="images"] [data-ai-advanced-toggle]').click()
    await capture('ai-current-light.png')
  })
  for (const mode of ['light', 'dark']) {
    if (builtin) await check(`${mode}: monochrome logos adapt while colored and custom logos keep their colors`, async () => {
      await page.setViewportSize({ width: 1040, height: 720 }); await load(mode, 'en', 'logos')
      for (const name of ['ChatGPT', 'Minimax', 'DeepSeek', 'Claude', 'Manifest', 'Custom']) {
        const image = page.locator(`[data-logo-preview="${name}"]`).locator('[role="img"], img:not([style])').first()
        await image.waitFor()
        await image.evaluate(element => (element instanceof HTMLImageElement ? element : element.querySelector('img')!).decode())
        const filter = await image.evaluate(element => getComputedStyle(element).filter)
        const adapts = ['ChatGPT', 'Minimax', 'DeepSeek'].includes(name)
        assert.equal(filter, mode === 'dark' && adapts ? 'invert(1)' : 'none', `${name} ${mode}`)
      }
      await capture(`logos-${mode}.png`); await page.setViewportSize({ width: 1040, height: 1580 })
    })
    await check(`${mode}: actual user messages use neutral gray with readable text`, async () => {
      await page.setViewportSize({ width: 1040, height: 720 }); await load(mode, 'zh-Hans', 'chat')
      const bubble = page.locator('[data-user-message-preview] .bg-user-message-bubble').first()
      const surface = await bubble.evaluate(element => getComputedStyle(element).backgroundColor)
      const channels = surface.match(/[\d.]+/g)!.slice(0, 3).map(Number)
      assert(Math.max(...channels) - Math.min(...channels) <= 1, `Unexpected color tint: ${surface}`)
      const value = channels[0]!
      assert(mode === 'light' ? value >= 230 && value < 252 : value >= 30 && value <= 60, `Unexpected surface brightness: ${surface}`)
      const reading = (await readContrast(page)).find(pair => pair.surface === '--user-message-bubble')!
      assert(reading.ratio >= 4.5, `Unreadable message text: ${reading.ratio}`)
      messageSurfaces.push({ mode, background: surface, textContrast: reading.ratio })
      await capture(`chat-${mode}.png`)
      await page.setViewportSize({ width: 1040, height: 1580 })
    })
    await check(`${mode}: actual AI settings, readable tokens, right-side controls`, async () => {
      await load(mode)
      assert.equal(await page.getByRole('tablist').count(), 0)
      await page.locator('[data-ai-advanced="images"] [data-ai-advanced-toggle]').click()
      assert((await page.locator('[data-image-generation-settings]').innerText()).includes('Not configured'))
      const surface = await page.locator('.craft-settings-card').first().evaluate(e => getComputedStyle(e).backgroundColor)
      if (mode === 'light') assert.equal(surface, 'rgb(255, 255, 255)')
      const readings = await readContrast(page)
      contrast.push({ mode, readings })
      for (const reading of readings) assert(reading.ratio >= reading.minimum, `${reading.text} on ${reading.surface}: ${reading.ratio.toFixed(2)}:1`)
      await capture(`ai-${mode}.png`)
      await page.locator('#context-policy-select').scrollIntoViewIfNeeded()
      assert(await page.locator('#context-policy-select').evaluate(e => e.getBoundingClientRect().x > e.closest('[data-layout="settings-row"]')!.querySelector('label')!.getBoundingClientRect().right))
      await page.locator('#context-policy-select').click()
      await page.locator('[data-slot="popover-content"][data-state="open"]').waitFor()
      await capture(`menu-${mode}.png`)
      await page.keyboard.press('Escape')
    })
    await check(`${mode}: real buttons, input focus, toggles and destructive action`, async () => {
      await page.setViewportSize({ width: 1040, height: 1100 }); await load(mode, 'en', 'controls')
      await page.getByRole('switch', { name: 'Enabled setting' }).click()
      assert.equal(await page.getByRole('switch', { name: 'Enabled setting' }).getAttribute('aria-checked'), 'false')
      const input = page.getByRole('textbox', { name: 'Preview input' })
      await input.focus(); await input.fill('Input · 清晰文本')
      assert.equal(await input.inputValue(), 'Input · 清晰文本')
      await capture(`controls-${mode}.png`)
      await page.setViewportSize({ width: 1040, height: 1580 })
    })
    await check(`${mode}: actual connection menu and rename dialog`, async () => {
      await page.setViewportSize({ width: 1040, height: 920 }); await load(mode)
      const row = page.locator('[data-layout="settings-row"]').filter({ has: page.locator('[aria-haspopup="menu"]') }).filter({ hasText: 'ChatGPT Plus' })
      await row.getByRole('button').click()
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      await page.getByRole('dialog').waitFor()
      await capture(`dialog-${mode}.png`)
      await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1040, height: 1580 })
    })
  }
  await check('Chinese 480px: no overflow or missing translations', async () => {
    await page.setViewportSize({ width: 480, height: 1060 }); await load('light', 'zh-Hans')
    await capture('ai-light-zh-480.png')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert(!/settings\.ai\.|permissions\.guarded/.test(await page.locator('#root').innerText()))
  })
} finally {
  await browser.close(); await server.close()
  await check('Built-in theme, canonical definition, CSS and AI page unchanged', () => {
    assert.deepEqual(Object.fromEntries(guardedPaths.map(path => [path, hash(resolve(root, path))])), before)
  })
  writeFileSync(resolve(builtin ? screenshotDirectory : output, 'validation.json'), JSON.stringify({ selectedTheme, themeSha256: hash(builtin ? resolve(root, 'apps/electron/resources/themes/default.json') : themePath),
    records, errors, contrast, messageSurfaces, protectedFiles: before, personalProfileAccess: false }, null, 2))
}
console.log(JSON.stringify({ records, errors })); process.exit(records.every(r => r.pass) && !errors.length ? 0 : 1)

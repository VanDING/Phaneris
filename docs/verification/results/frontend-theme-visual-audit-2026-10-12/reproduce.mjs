/** Run with Bun from the repository root. This records defects; it does not approve them. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, relative, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { parse } from '@babel/parser'
import { BUILTIN_THEMES } from '../../../../packages/shared/src/config/theme.ts'
import { PresetThemeSchema } from '../../../../packages/shared/src/config/schemas.ts'

const root = resolve(import.meta.dirname, '../../../..')
const outputArg = process.argv.find(value => value.startsWith('--output='))?.slice(9)
const output = resolve(root, outputArg ?? '.cache/frontend-theme-visual-audit-rerun')
const cache = resolve(root, '.cache/frontend-theme-visual-audit')
mkdirSync(output, { recursive: true }); mkdirSync(cache, { recursive: true })
const hash = value => createHash('sha256').update(value).digest('hex')
const roots = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/webui/src', 'apps/viewer/src']
const files = []
function walk(directory) {
  for (const item of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${item.name}`
    if (item.isDirectory()) walk(path)
    else if (['.ts', '.tsx', '.css'].includes(extname(path))) files.push(path)
  }
}
roots.forEach(walk); files.sort()
const patterns = {
  arbitraryRadius: /\brounded(?:-[trblsexy]{1,2})?-\[(?:\d+(?:\.\d+)?)(?:px|rem)\]/g,
  arbitraryFontSize: /\btext-\[(?:\d+(?:\.\d+)?)(?:px|rem)\]/g,
  arbitrarySpacingOrSize: /\b(?:p[trblxyse]?|m[trblxyse]?|gap(?:-[xy])?|[wh]|min-[wh]|max-[wh]|space-[xy])-\[(?:\d+(?:\.\d+)?)(?:px|rem)\]/g,
  arbitraryForegroundFill: /\bbg-foreground\/\[(?:\d+(?:\.\d+)?)\]/g,
  numericZClass: /(?<![\w-])-?z-(?:\d+|\[\d+\])(?![\w-])/g,
  arbitraryNumericZClass: /(?<![\w-])-?z-\[\d+\](?![\w-])/g,
  transitionAll: /\btransition-all\b/g,
  literalDurationClass: /\bduration-\d+\b/g,
  hexLiteral: /(?<![\w-])#[\da-fA-F]{3,8}\b/g,
}
const inventory = []
for (const path of files) {
  const content = readFileSync(resolve(root, path), 'utf8')
  const production = !/(?:\/playground\/|\/__tests__\/|\.(?:test|spec|isolated)\.[^.]+$)/.test(path)
  // Candidate matches are lexical, with comments excluded; they are not lint findings.
  let lexical = content
  let nativeButtons = 0, nativeInputs = 0, roleClassStrings = 0
  if (path.endsWith('.css')) lexical = content.replace(/\/\*[\s\S]*?\*\//g, '')
  else {
    const ast = parse(content, { sourceType: 'module', plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] })
    const literals = []
    function visit(node) {
      if (node.type === 'StringLiteral') {
        literals.push(node.value)
        if (/\bcraft-[\w-]+/.test(node.value)) roleClassStrings++
      }
      if (node.type === 'TemplateElement') {
        literals.push(node.value.cooked ?? node.value.raw)
      }
      if (node.type === 'JSXOpeningElement') {
        const tag = node.name.type === 'JSXIdentifier' ? node.name.name : ''
        if (tag === 'button') nativeButtons++
        if (['input', 'textarea', 'select'].includes(tag)) nativeInputs++
      }
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
        if (Array.isArray(value)) value.forEach(child => { if (child?.type) visit(child) })
        else if (value?.type) visit(value)
      }
    }
    visit(ast); lexical = literals.join('\n')
  }
  const counts = Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [key, [...lexical.matchAll(pattern)].length]))
  inventory.push({ path, production, sha256: hash(content), bytes: Buffer.byteLength(content), counts, nativeButtons, nativeInputs, roleClassStrings })
}
const countSummary = set => ({ files: set.length, nativeButtonElements: set.reduce((sum, value) => sum + value.nativeButtons, 0),
  filesWithNativeButtons: set.filter(value => value.nativeButtons).length,
  filesWithRoleClassStrings: set.filter(value => value.roleClassStrings).length,
  candidates: Object.fromEntries(Object.keys(patterns).map(key => [key, set.reduce((sum, value) => sum + value.counts[key], 0)])) })
const extraSources = ['packages/shared/src/config/theme.ts', 'packages/shared/src/config/schemas.ts', 'packages/shared/src/config/appearance.ts',
  'packages/shared/src/config/watcher.ts', 'apps/electron/eslint.config.mjs', 'packages/ui/eslint.config.mjs', '.github/workflows/validate.yml',
  'apps/electron/src/renderer/context/ThemeContext.tsx', 'docs/process/frontend-visual-audit-2026-10-11.html']
const sourceHashes = Object.fromEntries([...files, ...extraSources].map(path => [path, hash(readFileSync(resolve(root, path)))]))
const evidence = {
  date: '2026-10-12', timezone: 'Asia/Shanghai', generatedAt: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).reduce((summary, value) => {
    const code = value.slice(0, 2); summary[code] = (summary[code] ?? 0) + 1; return summary
  }, {}),
  sourceHashes, inventory: { method: 'TS AST literal candidates and native opening tags; CSS comments excluded. Counts are not lint violations or component coverage.',
    summary: countSummary(inventory), production: countSummary(inventory.filter(value => value.production)),
    byRoot: Object.fromEntries(roots.map(prefix => [prefix, countSummary(inventory.filter(value => value.path.startsWith(prefix)))])), files: inventory },
  schema: [], hosts: [], lifecycle: [], accessibility: [], geometry: [], portal: [], pageErrors: [], consoleErrors: [], observations: [],
}
for (const [id, theme] of Object.entries(BUILTIN_THEMES)) evidence.schema.push({ id, input: 'builtin', accepted: PresetThemeSchema.safeParse(theme).success })
for (const [id, input] of Object.entries({
  invalidColor: { name: 'Invalid color', background: 'banana' },
  invalidLength: { name: 'Invalid length', accent: '#5438bb', radius: '-8px', fontSize: 'banana' },
  transparentPopover: { name: 'Transparent popover', accent: '#5438bb', popoverSolid: 'transparent' },
  invalidShiki: { name: 'Invalid Shiki', accent: '#5438bb', shikiTheme: { dark: 'not-a-shiki-theme' } },
  scenicNoImage: { name: 'Scenic without image', accent: '#5438bb', mode: 'scenic' },
  injection: { name: 'Injection', accent: '#5438bb; color:red' },
  unknownKey: { name: 'Unknown key', accent: '#5438bb', inventedToken: 1 },
})) evidence.schema.push({ id, input, accepted: PresetThemeSchema.safeParse(input).success })

writeFileSync(resolve(cache, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/docs/verification/results/frontend-theme-visual-audit-2026-10-12/audit-fixture.tsx"></script></body></html>')
const server = await createServer({ configFile: resolve(root, 'apps/electron/vite.config.ts'), root,
  server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/runtimes/**', `${output}/**`] } } })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}/.cache/frontend-theme-visual-audit/index.html`
const browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL })
evidence.browser = { version: browser.version(), viewport: { width: 1280, height: 820 }, dpr: 1, runtime: process.versions.bun }
const page = await browser.newPage({ viewport: evidence.browser.viewport })
page.on('pageerror', error => evidence.pageErrors.push(error.message))
page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()) })
page.route('https://audit.invalid/**', route => route.abort())
async function ready(id = 'default', status = 'ready', requested = id) {
  await page.waitForFunction(({ id, status, requested }) => window.auditSnapshot?.applied === id && window.auditSnapshot?.status === status
    && window.auditSnapshot?.requested === requested && document.documentElement.dataset.themeStatus === status
    && (status !== 'error' || window.auditSnapshot?.error?.includes(`"${requested}"`)), { id, status, requested })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}
async function load(host, mode = 'light') {
  await page.goto(`${base}?host=${host}&mode=${mode}`, { waitUntil: 'networkidle' })
  await ready()
}
async function setTheme(id) { await page.evaluate(id => window.auditActions.setColorTheme(id), id); await ready(id) }
async function snapshot() {
  return page.evaluate(() => {
    const root = document.documentElement, css = getComputedStyle(root)
    const colors = {}, sample = document.createElement('span')
    document.body.append(sample)
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    function rgb(color) {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1)
      return Array.from(ctx.getImageData(0, 0, 1, 1).data)
    }
    for (const token of ['background', 'foreground', 'accent', 'paper', 'input', 'popover-solid', 'border', 'muted-foreground',
      'secondary', 'ring', 'success-text', 'destructive-text', 'info-text', 'foreground-5', 'foreground-50']) {
      sample.style.color = `var(--${token})`
      const value = getComputedStyle(sample).color
      colors[token] = { css: value, sRGB: rgb(value) }
    }
    sample.remove()
    const elements = {}
    for (const name of ['native', 'button', 'danger', 'icon', 'input', 'select', 'radius', 'density', 'motion']) {
      const element = document.querySelector(`[data-audit="${name}"]`), style = getComputedStyle(element), rect = element.getBoundingClientRect()
      elements[name] = { width: rect.width, height: rect.height, color: style.color, colorRGB: rgb(style.color),
        background: style.backgroundColor, backgroundRGB: rgb(style.backgroundColor), border: style.borderColor,
        radius: style.borderRadius, fontSize: style.fontSize, lineHeight: style.lineHeight, padding: style.padding, outline: style.outline,
        shadow: style.boxShadow, duration: style.transitionDuration }
    }
    const shadows = Object.fromEntries([...document.querySelectorAll('[data-shadow]')].map(element => [element.dataset.shadow, getComputedStyle(element).boxShadow]))
    const icon = document.querySelector('[data-audit="icon"] svg')
    return { state: window.auditSnapshot, className: root.className, dataset: { ...root.dataset }, colors, elements, shadows,
      raw: Object.fromEntries(['theme-radius', 'theme-panel-radius', 'theme-density', 'motion-duration-fast', 'shadow-xs', 'shadow-sm'].map(key => [key, css.getPropertyValue(`--${key}`).trim()])),
      iconStroke: getComputedStyle(icon).strokeWidth, inlineCSS: document.getElementById('craft-theme-overrides')?.textContent }
  })
}
function luminance(channels) { const c = channels.slice(0, 3).map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
function contrast(fg, bg) { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
function addContrast(sample) {
  sample.contrast = ['foreground', 'muted-foreground', 'accent', 'info-text', 'success-text', 'destructive-text'].map(token => ({
    token, surface: 'background', ratio: contrast(sample.colors[token].sRGB, sample.colors.background.sRGB), threshold: 4.5,
    applicable: sample.colors[token].sRGB[3] === 255 && sample.colors.background.sRGB[3] === 255,
  }))
  for (const name of ['button', 'danger']) {
    const value = sample.elements[name]
    sample.contrast.push({ element: name, ratio: contrast(value.colorRGB, value.backgroundRGB), threshold: 4.5,
      applicable: value.colorRGB[3] === 255 && value.backgroundRGB[3] === 255 })
  }
}
try {
  for (const host of ['electron', 'ui', 'viewer', 'webui']) {
    for (const mode of ['light', 'dark']) {
      await load(host, mode)
      const sample = await snapshot(); addContrast(sample)
      evidence.hosts.push({ host, requestedMode: mode, theme: 'default', ...sample })
      await page.screenshot({ path: resolve(output, `${host}-default-${mode}.png`) })
    }
  }
  await load('electron')
  for (const id of Object.keys(BUILTIN_THEMES).filter(id => id !== 'default')) {
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => window.auditActions.setMode(mode), mode)
      await setTheme(id)
      const sample = await snapshot(); addContrast(sample)
      evidence.hosts.push({ host: 'electron', requestedMode: mode, theme: id, ...sample })
      await page.screenshot({ path: resolve(output, `electron-${id}-${mode}.png`) })
    }
  }
  await load('electron')
  await page.keyboard.press('Tab')
  evidence.accessibility.push({ scenario: 'keyboard-native', ...await page.evaluate(() => {
    const element = document.activeElement, css = getComputedStyle(element)
    return { tag: element.tagName, audit: element.getAttribute('data-audit'), focusVisible: element.matches(':focus-visible'), outline: css.outline, boxShadow: css.boxShadow }
  }) })
  await page.screenshot({ path: resolve(output, 'keyboard-native.png') })
  await page.keyboard.press('Tab')
  evidence.accessibility.push({ scenario: 'keyboard-shared-button', ...await page.evaluate(() => {
    const element = document.activeElement, css = getComputedStyle(element)
    return { audit: element.getAttribute('data-audit'), focusVisible: element.matches(':focus-visible'), outline: css.outline, boxShadow: css.boxShadow }
  }) })
  await page.screenshot({ path: resolve(output, 'keyboard-role-button.png') })
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  evidence.accessibility.push({ scenario: 'reduce-forced', snapshot: await snapshot() })
  await page.screenshot({ path: resolve(output, 'reduce-forced.png') })
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' })
  const baseline = await snapshot()
  evidence.geometry.push({ scenario: 'normal', snapshot: baseline })
  for (const id of ['audit-size', 'audit-compact', 'audit-cozy', 'audit-invalid']) {
    await setTheme(id); evidence.geometry.push({ scenario: id, snapshot: await snapshot() })
  }
  await load('electron')
  await page.locator('[data-audit="select"]').click()
  const beforePortal = await page.locator('[data-slot="select-content"]').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, radius: getComputedStyle(element).borderRadius }))
  await page.evaluate(() => window.auditActions.setColorTheme('geek'))
  await ready('geek')
  const afterPortal = await page.locator('[data-slot="select-content"]').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, radius: getComputedStyle(element).borderRadius }))
  evidence.portal.push({ before: beforePortal, after: afterPortal })
  await page.screenshot({ path: resolve(output, 'open-menu-theme-change.png') })
  await page.keyboard.press('Escape')
  evidence.portal.push({ afterEscape: await page.evaluate(() => document.activeElement?.getAttribute('data-audit')) })
  await load('electron')
  await setTheme('ink')
  await page.evaluate(() => { window.auditHarness.delays.geek = 600; window.auditActions.setColorTheme('geek') })
  await page.waitForTimeout(80)
  evidence.lifecycle.push({ scenario: 'loading-last-good', snapshot: await snapshot() })
  await setTheme('cyberpunk-2077'); await page.waitForTimeout(700)
  evidence.lifecycle.push({ scenario: 'late-response', snapshot: await snapshot() })
  await page.evaluate(() => window.auditActions.setColorTheme('missing-audit-theme')); await ready('default', 'error', 'missing-audit-theme')
  evidence.lifecycle.push({ scenario: 'missing-fallback', snapshot: await snapshot() })
  await page.evaluate(() => { window.auditHarness.failures.push('geek'); window.auditActions.setColorTheme('geek') }); await ready('default', 'error', 'geek')
  evidence.lifecycle.push({ scenario: 'rejected-fallback', snapshot: await snapshot() })
  await load('electron')
  await setTheme('ink')
  await page.evaluate(() => window.auditActions.setWorkspaceColorTheme('cyberpunk-2077')); await ready('cyberpunk-2077')
  evidence.lifecycle.push({ scenario: 'workspace-wins', snapshot: await snapshot() })
  await page.evaluate(() => window.auditActions.setPreviewColorTheme('geek')); await ready('geek')
  evidence.lifecycle.push({ scenario: 'preview-wins', snapshot: await snapshot() })
  await page.evaluate(() => window.auditActions.setPreviewColorTheme(null)); await ready('cyberpunk-2077')
  evidence.lifecycle.push({ scenario: 'preview-cleared', snapshot: await snapshot() })
  await page.evaluate(() => window.auditActions.setWorkspaceColorTheme(null)); await ready('ink')
  await page.evaluate(() => { window.auditHarness.preferenceFailure = true; window.auditActions.setColorTheme('geek') })
  await page.waitForFunction(() => Boolean(window.auditSnapshot?.preferenceError)); await ready('ink')
  evidence.lifecycle.push({ scenario: 'save-failure-rollback', snapshot: await snapshot() })
  // Scenic probe is a fixture-only URL; all remote requests to it are blocked.
  await load('electron'); await setTheme('audit-glass')
  evidence.lifecycle.push({ scenario: 'scenic-transparent-popover', snapshot: await snapshot() })
  await setTheme('default')
  evidence.lifecycle.push({ scenario: 'scenic-exit', snapshot: await snapshot() })
  await page.goto(`${base}?host=webui&bridgeDelay=300&persistedTheme=geek`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.evaluate(() => window.auditHarness.emit('onThemePreferencesChange', window.auditHarness.preferences))
  await page.waitForTimeout(200)
  evidence.lifecycle.push({ scenario: 'webui-late-api', snapshot: await snapshot(),
    bridge: await page.evaluate(() => ({ installed: Boolean(window.electronAPI), persisted: window.auditHarness.preferences,
      calls: window.auditHarness.calls, subscriptions: window.auditHarness.subscriptionCounts() })) })
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await touch.goto(`${base}?host=webui`, { waitUntil: 'networkidle' })
  await touch.waitForFunction(() => window.auditSnapshot?.status === 'ready')
  evidence.geometry.push({ scenario: 'webui-touch-390', sample: await touch.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight }, coarse: matchMedia('(pointer:coarse)').matches,
    zoom: getComputedStyle(document.documentElement).zoom,
    controls: [...document.querySelectorAll('[data-audit]')].map(element => ({ name: element.getAttribute('data-audit'), width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height, cssHeight: getComputedStyle(element).height, minHeight: getComputedStyle(element).minHeight }))
  })) })
  await touch.screenshot({ path: resolve(output, 'webui-touch-390.png') }); await touch.close()
  // Supplement with existing product page fixtures; these keep account data synthetic.
  writeFileSync(resolve(cache, 'product.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/default-theme-preview.tsx"></script></body></html>')
  evidence.productPages = []
  for (const view of ['ai', 'controls', 'chat']) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width: 1040, height: view === 'ai' ? 1180 : 820 })
    await page.goto(`${base.replace('index.html', 'product.html')}?theme=default&mode=${mode}&lang=zh-Hans&view=${view}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.defaultThemePreviewState?.ready === true)
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400)
    await page.screenshot({ path: resolve(output, `product-${view}-${mode}.png`) })
    evidence.productPages.push({ view, mode, fixture: 'scripts/verification/fixtures/default-theme-preview.tsx',
      viewport: page.viewportSize(), bodyWidth: await page.evaluate(() => document.body.scrollWidth) })
  }
  await page.setViewportSize({ width: 1040, height: 820 })
  await page.goto(`${base}?host=viewer&codeProbe=true`, { waitUntil: 'networkidle' })
  await page.locator('.shiki').waitFor()
  const codeSnapshot = () => page.evaluate(() => ({ rootDark: document.documentElement.classList.contains('dark'),
    shikiClass: document.querySelector('.shiki')?.className,
    colors: [...document.querySelectorAll('.shiki span[style]')].map(element => getComputedStyle(element).color) }))
  evidence.code = [{ phase: 'before', ...await codeSnapshot() }]
  await page.evaluate(() => window.auditCodeActions.toggle())
  await page.waitForTimeout(800)
  evidence.code.push({ phase: 'after-dark-toggle', ...await codeSnapshot() })
  await page.screenshot({ path: resolve(output, 'viewer-code-dark-toggle.png') })
  // Integration probe: actual Viewer App/SessionViewer/TurnCard, synthetic HTTP response.
  await page.emulateMedia({ colorScheme: 'light' })
  await page.route('**/s/api/audit-theme', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    id: 'audit-theme', name: 'Theme audit — code subscription', createdAt: 0, updatedAt: 0,
    workspaceId: 'audit', messages: [
      { id: 'audit-user', type: 'user', content: 'Show code', timestamp: 1 },
      { id: 'audit-response', type: 'assistant', content: '```typescript\nconst audit = 1\nconsole.log(audit)\n```', timestamp: 2, isIntermediate: false },
    ],
  }) }))
  await page.goto(`${base}?host=viewer&viewerApp=true`, { waitUntil: 'networkidle' })
  await page.locator('.shiki').waitFor()
  await page.evaluate(() => document.fonts.ready)
  evidence.viewerApp = [{ phase: 'before', ...await codeSnapshot() }]
  await page.screenshot({ path: resolve(output, 'viewer-app-code-light.png') })
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.waitForTimeout(800)
  evidence.viewerApp.push({ phase: 'after-dark-toggle', ...await codeSnapshot() })
  await page.screenshot({ path: resolve(output, 'viewer-app-code-dark.png') })
} catch (error) {
  evidence.failurePage = { url: page.url(), text: await page.locator('body').innerText() }
  await page.screenshot({ path: resolve(output, 'audit-error.png') })
  evidence.runError = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  evidence.sourceUnchanged = Object.entries(sourceHashes).every(([path, digest]) => hash(readFileSync(resolve(root, path))) === digest)
  writeFileSync(resolve(output, 'audit-data.json'), JSON.stringify(evidence, null, 2) + '\n')
  await browser.close(); await server.close()
}
console.log(JSON.stringify({ output, hostSamples: evidence.hosts.length, lifecycleSamples: evidence.lifecycle.length,
  pageErrors: evidence.pageErrors, runError: evidence.runError, sourceUnchanged: evidence.sourceUnchanged, production: evidence.inventory.production }, null, 2))

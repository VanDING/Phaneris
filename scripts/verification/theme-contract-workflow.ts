/** TC01–TC10: authored before W2 implementation; browser tests keep failure evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { BUILTIN_THEMES } from '../../packages/shared/src/config/theme'
import { PresetThemeSchema } from '../../packages/shared/src/config/schemas'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'
import { verifyFrontendP2 } from './frontend-p2-checks'

await verificationWorkflow('theme-contract', async run => {
  const root = resolve(import.meta.dir, '../..'), fixture = join(root, 'scripts/verification/fixtures/theme-contract.tsx')
  const checks: { id: string; passed: boolean; error?: string }[] = [], samples: unknown[] = [], errors: string[] = []
  const sources = ['packages/shared/src/config/theme.ts', 'packages/shared/src/config/schemas.ts', 'packages/shared/src/config/themes/ink.json',
    'packages/ui/src/styles/index.css', 'apps/electron/src/renderer/index.css', 'apps/viewer/src/index.css', 'apps/viewer/src/App.tsx',
    'apps/electron/src/renderer/context/ThemeContext.tsx', 'packages/ui/src/context/ShikiThemeContext.tsx',
    'packages/ui/src/components/markdown/CodeBlock.tsx', 'packages/ui/src/lib/theme-compiler.ts', 'packages/shared/src/config/theme-runtime.ts',
    'packages/ui/src/styles/theme-tokens.css', 'packages/ui/src/styles/theme-adapter.css', 'packages/ui/src/styles/motion.css', 'packages/shared/src/config/theme-manifest.ts',
    'packages/ui/src/components/overlay/CopyButton.tsx', 'apps/electron/src/renderer/components/ui/scroll-area.tsx',
    'apps/electron/src/renderer/components/ui/entity-list.tsx', 'scripts/verification/frontend-p2-checks.ts', 'scripts/verification/fixtures/frontend-p2.tsx',
    'packages/shared/src/config/shiki-themes.generated.json', 'scripts/verification/fixtures/theme-contract.tsx', 'scripts/verification/theme-contract-workflow.ts']
  run.json('source-hashes.json', Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])))
  async function check(id: string, fn: () => Promise<void> | void) {
    try { await fn(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) }
  }
  const hosts = { electron: 'apps/electron/src/renderer/index.css', ui: 'packages/ui/src/styles/index.css',
    viewer: 'apps/viewer/src/index.css', webui: 'apps/webui/src/index.css' }
  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/theme-contract.tsx"></script></body></html>')
  for (const [host, path] of Object.entries(hosts)) writeFileSync(join(run.directory, `${host}.css`),
    `@import "${relative(run.directory, join(root, path)).replaceAll('\\', '/')}";\n@source "${fixture.replaceAll('\\', '/')}";\n@source "${join(root, 'scripts/verification/fixtures/frontend-p2.tsx').replaceAll('\\', '/')}";\n`)
  const launched = await launchWorkflowBrowser()
  const server = await createServer({ configFile: join(root, 'apps/electron/vite.config.ts'), root,
    optimizeDeps: { entries: [fixture, join(root, 'apps/viewer/src/App.tsx')], include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'], exclude: ['pdfjs-dist/build/pdf.worker.min.mjs?url'] },
    server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/runtimes/**', `${run.directory}/**`] } } })
  await server.listen()
  const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce', colorScheme: 'light' })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  await context.tracing.start({ screenshots: true, snapshots: true })
  const state = async () => JSON.parse(await page.getByTestId('state').innerText())
  async function choose(id: string, mode: 'light' | 'dark', theme?: Record<string, unknown>) {
    await page.evaluate(({ id, mode, theme }) => window.themeContract.choose(id, mode, theme as never), { id, mode, theme })
    await page.waitForFunction(id => {
      const state = JSON.parse(document.querySelector('[data-testid="state"]')?.textContent || '{}')
      return state.requested === id && (state.status === 'error' || state.status === 'ready' && state.applied === id)
    }, id)
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
    })
  }
  const parity = new Map<string, unknown>()
  try {
    run.json('preparation.json', await warmThemePage(context, `${base}${prefix}/index.html?css=${encodeURIComponent(`${prefix}/electron.css`)}`, '[data-contract-ready]'))
    for (const host of Object.keys(hosts)) {
      await gotoWithRetry(page, `${base}${prefix}/index.html?css=${encodeURIComponent(`${prefix}/${host}.css`)}`)
      await page.locator('[data-contract-ready]').waitFor()
      for (const id of Object.keys(BUILTIN_THEMES)) for (const mode of ['light', 'dark'] as const) {
        await choose(id, mode)
        await check(`TC01-${host}-${id}-${mode}`, async () => {
          const sample = await page.evaluate(() => ({ step: getComputedStyle(document.querySelector('[data-testid="step"]')!).backgroundColor,
            radius: getComputedStyle(document.querySelector('[data-testid="control"]')!).borderRadius,
            stroke: getComputedStyle(document.querySelector('[data-testid="circle"]')!).strokeWidth }))
          samples.push({ host, id, mode, parity: sample }); const key = `${id}-${mode}`
          if (parity.has(key)) assert.deepEqual(sample, parity.get(key)); else parity.set(key, sample)
        })
        await check(`TC07-${host}-${id}-${mode}`, async () => {
          const contrasts = await page.locator('[data-contrast]').evaluateAll(elements => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d')!
            const rgba = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data] }
            const blend = (top: number[], bottom: number[]) => top.slice(0, 3).map((value, i) => value * top[3] / 255 + bottom[i] * (1 - top[3] / 255))
            const luminance = (rgb: number[]) => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
            return elements.map(element => { const css = getComputedStyle(element)
              const fg = rgba(css.color), bg = rgba(css.backgroundColor), opaque = blend(bg, rgba(getComputedStyle(document.body).backgroundColor))
              const a = luminance(blend(fg, [...opaque, 255])), b = luminance(opaque)
              return { role: element.getAttribute('data-contrast'), color: css.color, background: css.backgroundColor, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
            })
          }); samples.push({ host, id, mode, contrasts }); assert(contrasts.every(value => value.ratio >= 4.5), JSON.stringify(contrasts.filter(value => value.ratio < 4.5)))
        })
      }
      await choose('ink', 'light'); await page.screenshot({ path: join(run.directory, `${host}-ink-light.png`) })
    }
    const invalid: Record<string, Record<string, unknown>> = {
      banana: { background: 'banana' }, radius: { radius: '-8px' }, calculated: { radius: 'calc(2px - 8px)' },
      dimension: { borderWidth: '2s' }, fontsize: { fontSize: 'banana' }, zero: { fontSize: '0px' },
      missing: { background: 'var(--does-not-exist)' }, cycle: { background: 'var(--foreground)', foreground: 'var(--background)' },
      transparent: { popoverSolid: 'transparent' }, alpha: { dark: { popoverSolid: 'rgb(10 20 30 / .5)' } },
      'near-opaque': { popoverSolid: 'rgb(10 20 30 / .999)' },
      shiki: { shikiTheme: { light: 'not-a-shiki-theme' } }, scenic: { mode: 'scenic' },
      'broken-image': { mode: 'scenic', backgroundImage: `${base}/missing-theme-image.png` },
    }
    for (const [id, fields] of Object.entries(invalid)) await check(`TC02-${id}`, async () => {
      await choose(`invalid-${id}`, 'dark', { name: id, accent: '#5438bb', ...fields })
      const value = await state(); samples.push({ id, state: value })
      assert.equal(value.status, 'error'); assert.equal(value.applied, 'default'); assert(value.error)
      assert.equal(await page.locator('html').getAttribute('data-scenic'), null)
    })
    const valid = [
      { background: 'color-mix(in oklab, white 97%, black)', accent: 'oklch(.48 .15 280)', radius: 'calc(2px + 4px)' },
      { background: 'var(--paper)', foreground: 'var(--missing, #20232c)', fontSize: '1rem', radius: '.4rem' },
      { accent: 'rgb(90 40 170)', letterSpacing: '-.01em', lineHeight: 'calc(1.2 + .3)', popoverSolid: 'hsl(240 10% 20%)' },
      { accent: 'var(--缺失, #5438bb)', fontSans: '"var(--literal-font-name)", sans-serif' },
    ]
    for (const [index, fields] of valid.entries()) await check(`TC03-valid-${index}`, async () => {
      await choose(`valid-${index}`, 'light', { name: 'Modern CSS', accent: '#5438bb', ...fields }); const value = await state(); samples.push({ index, state: value })
      assert.equal(value.status, 'ready'); assert.equal(value.applied, `valid-${index}`)
    })
    await check('TC05-schema-scenic', () => assert(!PresetThemeSchema.safeParse({ name: 'Missing image', accent: '#123456', mode: 'scenic' }).success))
    await check('TC06-schema-shiki', () => assert(!PresetThemeSchema.safeParse({ name: 'Invalid shiki', accent: '#123456', shikiTheme: { dark: 'not-a-shiki-theme' } }).success))
    await check('TC09-snapshot', async () => {
      const value = await state(); assert(value.snapshot); assert.equal(value.snapshot.version, 1); assert.equal(value.snapshot.appliedId, value.applied)
      assert.equal(value.snapshot.actualMode, value.mode); assert(value.snapshot.revision); assert(value.snapshot.tokens); assert(Array.isArray(value.snapshot.diagnostics))
    })
    await check('TC08-code-overlay', async () => {
      await choose('default', 'light'); await page.getByTestId('open-code').click()
      const overlay = page.getByRole('dialog'); await overlay.locator('pre.shiki.github-light').waitFor({ timeout: 60_000 })
      const before = await overlay.locator('pre.shiki span[style]').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
      await choose('default', 'dark'); await overlay.locator('pre.shiki.github-dark').waitFor({ timeout: 60_000 })
      const after = await overlay.locator('pre.shiki span[style]').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
      assert.notDeepEqual(after, before); await page.screenshot({ path: join(run.directory, 'code-overlay-dark.png') })
      await page.keyboard.press('Escape'); await overlay.waitFor({ state: 'detached' })
    })
    await check('TC08-standalone', async () => {
      await gotoWithRetry(page, `${base}${prefix}/index.html?standalone=true&css=${encodeURIComponent(`${prefix}/ui.css`)}`, { waitUntil: 'networkidle' })
      await page.locator('pre.shiki.github-light').waitFor({ timeout: 60_000 }); await page.evaluate(() => window.themeContract.toggleDOM())
      await page.locator('pre.shiki.github-dark').waitFor({ timeout: 20_000 })
    })
    await check('TC08-viewer', async () => {
      await page.route('**/s/api/theme-contract', route => route.fulfill({ json: { id: 'theme-contract', name: '主题与代码', workspaceId: 'fixture', createdAt: 0, lastUsedAt: 0,
        messages: [{ id: 'user', type: 'user', content: 'Show code', timestamp: 1 },
          { id: 'assistant-code', type: 'assistant', content: '```typescript\nconst answer = 42;\nconsole.log(answer)\n```', timestamp: 2, isIntermediate: false }] } }))
      await gotoWithRetry(page, `${base}${prefix}/index.html?viewer=true&css=${encodeURIComponent(`${prefix}/viewer.css`)}`)
      await page.locator('pre.shiki.github-light').waitFor({ timeout: 60_000 }); await page.screenshot({ path: join(run.directory, 'viewer-code-light.png') })
      await page.getByRole('button', { name: 'Switch to dark mode' }).click()
      await page.locator('pre.shiki.github-dark').waitFor({ timeout: 20_000 }); await page.screenshot({ path: join(run.directory, 'viewer-code-dark.png') })
    })
    await check('TC14-viewer-explicit-mode', async () => {
      await page.emulateMedia({ colorScheme: 'dark' }); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await page.emulateMedia({ colorScheme: 'light' }); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      assert(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'An explicit Viewer choice survives an OS theme change')
      // The isolated server serves the fixture entry, while Viewer changes its
      // history to /s/theme-contract. Reopen the entry with the same origin/storage.
      await gotoWithRetry(page, `${base}${prefix}/index.html?viewer=true&css=${encodeURIComponent(`${prefix}/viewer.css`)}`, { waitUntil: 'networkidle' })
      await page.locator('pre.shiki.github-dark').waitFor({ timeout: 20_000 })
    })
    await check('TC18-page-errors', () => assert.deepEqual(errors, []))
    await verifyFrontendP2({ browser: launched.browser, directory: run.directory, check, samples,
      url: `${base}${prefix}/index.html?frontend-p2=true&css=${encodeURIComponent(`${prefix}/electron.css`)}` })
  } finally {
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') })
    run.json('theme-contract.json', { checks, samples, errors, browser: launched.browser.version(), viewport: { width: 1280, height: 820 },
      scope: 'Actual CSS/ThemeProvider/Viewer, synthetic bridge and HTTP session; no packaged/native/physical-device acceptance.' })
    await context.close(); await server.close(); await launched.close()
  }
  run.complete(checks.filter(value => value.passed).map(value => value.id), ['Packaged clients and native views', 'macOS/Linux', 'Physical touch devices and soft keyboard'])
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})

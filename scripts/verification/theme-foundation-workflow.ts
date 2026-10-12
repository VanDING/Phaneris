/** W1 / TF01–TF18. Authored and executed against failing baseline before product edits. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Page } from 'playwright'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { startProcess, testSecret, type RunningProcess } from './fixtures/governance-process-support'
import { RPC_CHANNELS } from '../../packages/shared/src/protocol/channels'

declare global { interface Window { themeWatchEvents: { themeId: string }[] } }

await verificationWorkflow('theme-foundation', async run => {
  const root = resolve(import.meta.dir, '../..')
  const checks: { id: string; passed: boolean; error?: string }[] = [], samples: unknown[] = []
  const pageErrors: string[] = [], transport: unknown[] = []
  const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const sources = ['apps/webui/src/main.tsx', 'apps/webui/src/App.tsx', 'apps/electron/src/renderer/context/ThemeContext.tsx',
    'apps/electron/src/renderer/index.css', 'packages/ui/src/styles/index.css', 'packages/ui/src/styles/controls.css',
    'packages/ui/src/styles/shadow-aliases.css',
    'packages/ui/src/styles/theme-tokens.css', 'packages/ui/src/styles/theme-adapter.css',
    'packages/ui/src/lib/theme-compiler.ts', 'packages/shared/src/config/theme-runtime.ts', 'packages/shared/src/config/theme-manifest.ts',
    'packages/shared/src/config/schemas.ts', 'packages/shared/src/config/appearance.ts', 'packages/shared/src/config/watcher.ts',
    'apps/webui/src/index.css', 'apps/viewer/src/index.css', 'packages/shared/src/config/theme.ts',
    'scripts/verification/fixtures/theme-foundation.tsx', 'scripts/verification/fixtures/theme-preferences-lifecycle.tsx',
    'scripts/verification/theme-foundation-workflow.ts']
  run.json('source-hashes.json', Object.fromEntries(sources.map(path => [path, sha256(join(root, path))])))
  async function check(id: string, fn: () => Promise<void>) {
    try { await fn(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  async function settle(target: Page) {
    await target.evaluate(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
  }
  async function focus(page: Page, selector: string) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    return page.locator(selector).evaluate(element => {
      const css = getComputedStyle(element), rect = element.getBoundingClientRect()
      return { focused: document.activeElement === element, visible: element.matches(':focus-visible'), outline: css.outlineStyle,
        width: parseFloat(css.outlineWidth), offset: parseFloat(css.outlineOffset), color: css.outlineColor,
        zoom: Number(getComputedStyle(document.documentElement).zoom) || 1,
        x: rect.x, y: rect.y, w: rect.width, h: rect.height, shadow: css.boxShadow }
    })
  }
  function visibleFocus(sample: Awaited<ReturnType<typeof focus>>) {
    assert(sample.focused && sample.visible, 'Keyboard target must match focus-visible')
    assert.notEqual(sample.outline, 'none', 'Keyboard outline must be visible')
    assert(sample.width * sample.zoom >= 2 - 0.01, `Keyboard outline must render at least 2px: ${JSON.stringify(sample)}`)
  }
  // Tailwind composes harmless transparent ring/inset slots before the shadow.
  // Compare painted layers while retaining all raw computed styles in evidence.
  function paintedShadow(value: string) {
    return value.split(/, (?=(?:rgba?|color|okl(?:ab|ch))\()/)
      .filter(layer => layer !== 'rgba(0, 0, 0, 0) 0px 0px 0px 0px').join(', ')
  }
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/theme-foundation.tsx"></script></body></html>')
  for (const [host, source] of Object.entries({ electron: 'apps/electron/src/renderer/index.css', ui: 'packages/ui/src/styles/index.css',
    viewer: 'apps/viewer/src/index.css', webui: 'apps/webui/src/index.css' }))
    writeFileSync(join(run.directory, `${host}.css`), `@import "${relative(run.directory, join(root, source)).replaceAll('\\', '/')}";\n@source "${join(root, 'scripts/verification/fixtures/theme-foundation.tsx').replaceAll('\\', '/')}";\n`)
  const launched = await launchWorkflowBrowser()
  const server = await createServer({ configFile: join(root, 'apps/electron/vite.config.ts'), root,
    optimizeDeps: { entries: [join(root, 'scripts/verification/fixtures/theme-foundation.tsx')],
      include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/runtimes/**', `${run.directory}/**`] } } })
  await server.listen()
  const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/${relative(root, run.directory).replaceAll('\\', '/')}/index.html`
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  await context.tracing.start({ screenshots: true, snapshots: true })
  let child: RunningProcess | undefined
  try {
    for (const host of ['electron', 'ui', 'viewer', 'webui']) {
      const css = `/${relative(root, run.directory).replaceAll('\\', '/')}/${host}.css`
      await page.goto(`${base}?host=${host}&css=${encodeURIComponent(css)}`, { waitUntil: 'networkidle', timeout: 120_000 })
      await page.locator('[data-foundation-ready]').waitFor()
      await page.evaluate(() => document.fonts.ready)
      for (const mode of ['light', 'dark'] as const) {
        await page.evaluate(mode => window.themeFoundation.apply(mode), mode)
        await settle(page)
        await check(`TF09-${host}-${mode}`, async () => {
          const before = Number((await page.getByTestId('native').innerText()).split(' ').at(-1))
          await page.getByTestId('native').click(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
          const native = await focus(page, '[data-testid="native"]'); samples.push({ host, mode, native }); visibleFocus(native)
          await page.keyboard.press('Space'); assert.equal(await page.getByTestId('native').innerText(), `原生按钮 ${before + 2}`)
          await page.keyboard.press('Tab'); visibleFocus(await focus(page, '[data-testid="link"]'))
        })
        await check(`TF10-${host}-${mode}`, async () => {
          await page.getByTestId('link').focus(); await page.keyboard.press('Tab')
          visibleFocus(await focus(page, '[data-testid="button"]'))
          await page.keyboard.press('Tab'); visibleFocus(await focus(page, '[data-testid="input"]'))
          await page.keyboard.press('Tab')
          const wrapped = await focus(page, '[data-testid="wrapped"]')
          const outline = await page.getByTestId('field').evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }))
          samples.push({ host, mode, wrapped, outline }); assert.equal(wrapped.outline, 'none'); assert.equal(outline.style, 'solid'); assert.equal(outline.width, '2px')
        })
        await check(`TF11-${host}-${mode}`, async () => {
          await page.getByTestId('select').focus(); await page.keyboard.press('Tab')
          const row = await focus(page, '[data-testid="row"]'); visibleFocus(row); assert(row.offset + row.width <= 0.01, JSON.stringify(row))
          const clip = await page.getByTestId('clip').boundingBox(); assert(clip)
          samples.push({ host, mode, row, clip })
          assert(row.x >= clip.x - 1 && row.y >= clip.y - 1 && row.x + row.w <= clip.x + clip.width + 1, 'Inset focus row stays inside the clipping container')
        })
        await check(`TF12-${host}-${mode}`, async () => {
          try {
            await page.getByTestId('wrapped').focus(); await page.keyboard.press('Tab'); visibleFocus(await focus(page, '[data-testid="select"]'))
            await page.keyboard.press('Space'); await page.getByRole('listbox').waitFor(); await settle(page)
            const before = await page.getByRole('listbox').evaluate(element => getComputedStyle(element).color)
            await page.evaluate(mode => window.themeFoundation.apply(mode), mode === 'light' ? 'dark' as const : 'light' as const)
            await settle(page)
            const after = await page.getByRole('listbox').evaluate(element => getComputedStyle(element).color)
            assert.notEqual(before, after, 'Open portal follows the mode')
            await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
            await page.getByRole('listbox').waitFor({ state: 'detached' })
            assert.equal(await page.getByTestId('select').innerText(), '第二项')
            await page.keyboard.press('Space'); await page.getByRole('listbox').waitFor()
            await page.keyboard.press('Escape'); await page.getByRole('listbox').waitFor({ state: 'detached' })
            visibleFocus(await focus(page, '[data-testid="select"]'))
            await page.evaluate(mode => window.themeFoundation.apply(mode), mode); await settle(page)
            await page.screenshot({ path: join(run.directory, `${host}-${mode}.png`) })
          } finally {
            await page.keyboard.press('Escape')
            await page.evaluate(mode => window.themeFoundation.apply(mode), mode)
          }
        })
        for (const depth of ['static', 'flat', 'elevated', 'neon', 'glass', 'raised'] as const) {
          await check(`TF13-TF14-${host}-${mode}-${depth}`, async () => {
            await page.evaluate(({ mode, depth }) => window.themeFoundation.apply(mode, depth), { mode, depth })
            await settle(page)
            const rawShadows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-shadow], [data-semantic]')]
              .map(element => [element.dataset.shadow ?? element.dataset.semantic!, getComputedStyle(element).boxShadow])))
            const shadows = Object.fromEntries(Object.entries(rawShadows).map(([name, value]) => [name, paintedShadow(value)]))
            samples.push({ host, mode, depth, rawShadows, shadows })
            for (const name of ['2xs', 'xs', 'sm', 'default', 'md', 'lg', 'xl', '2xl']) assert.notEqual(shadows[name], 'none', `${name} must resolve`)
            for (const [alias, semantic] of [['2xs', 'minimal-flat'], ['xs', 'minimal'], ['sm', 'minimal'], ['default', 'middle'], ['md', 'middle'], ['lg', 'strong'], ['xl', 'modal-small'], ['2xl', 'modal-small']])
              assert.equal(shadows[alias], shadows[semantic], `${alias} preserves ${semantic} elevation`)
            await page.mouse.move(0, 0)
            await settle(page)
            assert.equal(paintedShadow(await page.getByTestId('hover-shadow').evaluate(element => getComputedStyle(element).boxShadow)), shadows.xs)
            await page.getByTestId('hover-shadow').hover()
            await settle(page)
            assert.equal(paintedShadow(await page.getByTestId('hover-shadow').evaluate(element => getComputedStyle(element).boxShadow)), shadows.md)
          })
        }
      }
      await check(`TF15-${host}`, async () => {
        try {
          await page.emulateMedia({ forcedColors: 'active' })
          await page.getByTestId('link').focus(); await page.keyboard.press('Shift+Tab')
          const sample = await focus(page, '[data-testid="native"]'); visibleFocus(sample); samples.push({ host, forcedColors: sample })
          await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); visibleFocus(await focus(page, '[data-testid="button"]'))
        } finally { await page.emulateMedia({ forcedColors: 'none' }) }
      })
      await check(`TF16-${host}`, async () => {
        try {
          await page.setViewportSize({ width: 390, height: 820 })
          await page.evaluate(() => document.documentElement.style.setProperty('--font-size-base', '18px'))
          await page.getByTestId('link').focus(); await page.keyboard.press('Shift+Tab'); visibleFocus(await focus(page, '[data-testid="native"]'))
          await page.getByTestId('select').focus(); await page.keyboard.press('Tab'); const row = await focus(page, '[data-testid="row"]'); visibleFocus(row); assert(row.offset < 0, JSON.stringify(row))
          await page.screenshot({ path: join(run.directory, `${host}-390.png`) })
        } finally {
          await page.setViewportSize({ width: 1280, height: 820 })
          await page.evaluate(() => document.documentElement.style.removeProperty('--font-size-base'))
        }
      })
      console.log(JSON.stringify({ phase: `controls-${host}`, executed: checks.length }))
    }
    const lifecycle = await context.newPage()
    lifecycle.on('pageerror', error => pageErrors.push(error.message))
    await lifecycle.addInitScript(() => localStorage.setItem('craft-theme', JSON.stringify({ mode: 'dark', colorTheme: 'default', font: 'system' })))
    await lifecycle.goto(`${base}?lifecycle=true`, { waitUntil: 'networkidle' })
    await lifecycle.getByTestId('preference-state').waitFor()
    await check('TF17-legacy-not-replayed', async () => {
      await lifecycle.waitForFunction(() => document.querySelector('[data-testid="preference-state"]')?.textContent?.includes('"font":"system"'))
      const before = await lifecycle.evaluate(() => window.themePreferencesLifecycle.counts().writes)
      await lifecycle.evaluate(() => {
        window.themePreferencesLifecycle.setServer({ mode: 'light', colorTheme: 'default', font: 'inter' })
        window.themePreferencesLifecycle.reconnect()
      })
      await lifecycle.waitForFunction(() => document.querySelector('[data-testid="preference-state"]')?.textContent?.includes('"font":"inter"'), null, { timeout: 3000 })
      assert.equal(await lifecycle.evaluate(() => window.themePreferencesLifecycle.counts().writes), before)
    })
    for (const update of ['event', 'local'] as const) await check(`TF17-late-read-${update}`, async () => {
      await lifecycle.evaluate(() => {
        window.themePreferencesLifecycle.setServer({ mode: 'light', colorTheme: 'default', font: 'inter' })
        window.themePreferencesLifecycle.hold(); window.themePreferencesLifecycle.reconnect()
      })
      try {
        assert.equal(await lifecycle.evaluate(() => window.themePreferencesLifecycle.counts().pending), 1, 'Reconnect must start one read')
        await lifecycle.evaluate(update => {
        if (update === 'event') window.themePreferencesLifecycle.emit({ mode: 'dark', colorTheme: 'default', font: 'system' })
        else window.themePreferencesLifecycle.setFont('system')
        window.themePreferencesLifecycle.release()
        }, update)
        await lifecycle.waitForFunction(() => document.querySelector('[data-testid="preference-state"]')?.textContent?.includes('"font":"system"'))
        assert.equal(await lifecycle.evaluate(() => document.documentElement.dataset.font), 'system')
      } finally { await lifecycle.evaluate(() => window.themePreferencesLifecycle.release()) }
    })
    await check('TF17-subscription-cleanup', async () => {
      const live = await lifecycle.evaluate(() => window.themePreferencesLifecycle.counts())
      assert.equal(live.preferences, 1); assert.equal(live.connections, 1)
      await lifecycle.evaluate(() => { window.themePreferencesLifecycle.release(); window.themePreferencesLifecycle.unmount() })
      const removed = await lifecycle.evaluate(() => window.themePreferencesLifecycle.counts())
      assert.equal(removed.preferences, 0); assert.equal(removed.connections, 0)
    })
    await lifecycle.close(); await server.close()
    // Real HTTP authentication + WebSocket server + production WebUI. No fake bridge.
    const config = join(run.directory, 'config'), workspace = join(run.directory, 'workspace')
    mkdirSync(config); mkdirSync(workspace)
    writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'theme-fixture', name: 'Theme workspace', rootPath: workspace, createdAt: 1 }],
      activeWorkspaceId: 'theme-fixture', setupDeferred: true, themeMode: 'light', colorTheme: 'geek', themeFont: 'inter' }))
    const build = Bun.spawn([process.execPath, 'run', 'webui:build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
    writeFileSync(join(run.directory, 'production-web-build.log'), out + err); assert.equal(code, 0, err.slice(-2000))
    const dist = join(root, 'apps/webui/dist')
    run.json('build-hashes.json', readdirSync(dist, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && !entry.name.endsWith('.map'))
      .map(entry => { const file = join(entry.parentPath, entry.name); return { path: relative(dist, file).replaceAll('\\', '/'), sha256: sha256(file) } }))
    console.log(JSON.stringify({ phase: 'production-web-built', executed: checks.length }))
    child = await startProcess({ config, webui: dist, ready: false })
    const deadline = Date.now() + 90_000
    while (!child.url) {
      assert(child.process.exitCode === null, child.stderr().slice(-3000))
      assert(Date.now() < deadline, `Server readiness timeout: ${child.stderr().slice(-3000)}`)
      await Bun.sleep(100)
    }
    const webBase = child.url.replace(/^ws/, 'http')
    const webContexts = await Promise.all([launched.browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' }),
      launched.browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' })])
    for (const context of webContexts) assert((await context.request.post(new URL('/api/auth', webBase).href, { data: { password: testSecret } })).ok())
    const [first, second] = await Promise.all(webContexts.map(context => context.newPage()))
    for (const [index, target] of [first, second].entries()) {
      target.on('pageerror', error => pageErrors.push(error.message))
      target.on('websocket', socket => {
        const record = (direction: string, frame: { payload: string | Buffer }) => {
          try { const message = JSON.parse(String(frame.payload)); if (String(message.channel ?? '').includes('theme') || message.type === 'handshake')
            transport.push({ client: index, direction, type: message.type, channel: message.channel, args: message.args, payload: message.payload }) } catch { /* Other transport payload. */ }
        }
        socket.on('framesent', frame => record('send', frame))
        socket.on('framereceived', frame => record('receive', frame))
      })
    }
    await webContexts[0].tracing.start({ screenshots: true, snapshots: true })
    async function ready(target: Page) { await target.waitForFunction(() => !!window.electronAPI && document.documentElement.dataset.clientPlatform === 'web', null, { timeout: 60_000 }) }
    async function applied(target: Page, id: string, mode: string, font: string) {
      await target.waitForFunction(({ id, mode, font }) => (document.documentElement.dataset.theme ?? 'default') === id
        && document.documentElement.dataset.themeStatus === 'ready' && document.documentElement.classList.contains(mode)
        && document.documentElement.dataset.font === font, { id, mode, font }, { timeout: 5000 })
    }
    await check('TF01-delayed-ready', async () => {
      let release!: () => void
      const delayed = new Promise<void>(resolve => { release = resolve })
      await first.route('**/api/config', async route => { await delayed; await route.continue() })
      try {
        await first.goto(webBase, { waitUntil: 'domcontentloaded' })
        await first.getByText(/Connecting to server|正在连接服务器/).waitFor()
        const state = await first.evaluate(() => ({ themeStatus: document.documentElement.dataset.themeStatus, cache: localStorage.getItem('craft-theme') }))
        samples.push({ delayedReady: state }); assert.equal(state.themeStatus, undefined); assert.equal(state.cache, null)
      } finally { release(); await first.unrouteAll({ behavior: 'wait' }) }
    })
    await ready(first)
    await check('TF02-cold-start', async () => {
      await applied(first, 'geek', 'dark', 'inter')
      await first.getByText('Theme workspace', { exact: true }).first().waitFor({ timeout: 60_000 })
      await first.locator('.z-splash').waitFor({ state: 'detached' }); await settle(first)
      await first.screenshot({ path: join(run.directory, 'web-cold.png') })
    })
    await second.addInitScript(() => localStorage.setItem('craft-theme', JSON.stringify({ version: 3, mode: 'light', colorTheme: 'ink', font: 'system' })))
    await second.goto(webBase, { waitUntil: 'domcontentloaded' }); await ready(second)
    await check('TF03-stale-cache', () => applied(second, 'geek', 'dark', 'inter'))
    await check('TF04-cross-client', async () => {
      await second.evaluate(() => window.electronAPI.setThemePreferences({ mode: 'dark', colorTheme: 'ink', font: 'system' }))
      await applied(first, 'ink', 'dark', 'system'); await applied(second, 'ink', 'dark', 'system')
    })
    await check('TF05-reconnect-missed-event', async () => {
      try {
        await webContexts[0].setOffline(true); await first.evaluate(() => window.electronAPI.reconnectTransport())
        await waitForBrowserCondition(first, async () => (await window.electronAPI.getTransportConnectionState()).status !== 'connected')
        await second.evaluate(() => window.electronAPI.setThemePreferences({ mode: 'light', colorTheme: 'default', font: 'inter' }))
        await applied(second, 'default', 'light', 'inter')
      } finally { await webContexts[0].setOffline(false); await first.evaluate(() => window.electronAPI.reconnectTransport()) }
      await waitForBrowserCondition(first, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
      await applied(first, 'default', 'light', 'inter')
    })
    await check('TF06-post-reconnect-events', async () => {
      await second.evaluate(() => window.electronAPI.setThemePreferences({ mode: 'light', colorTheme: 'ink', font: 'system' }))
      await applied(first, 'ink', 'light', 'system'); await applied(second, 'ink', 'light', 'system')
    })
    await check('TF07-reload-persisted', async () => {
      const persisted = JSON.parse(readFileSync(join(config, 'config.json'), 'utf8'))
      assert.equal(persisted.colorTheme, 'ink'); assert.equal(persisted.themeMode, 'light'); assert.equal(persisted.themeFont, 'system')
      await first.reload({ waitUntil: 'domcontentloaded' }); await ready(first); await applied(first, 'ink', 'light', 'system')
      await first.getByText('Theme workspace', { exact: true }).first().waitFor({ timeout: 60_000 })
      await first.locator('.z-splash').waitFor({ state: 'detached' }); await settle(first)
      await first.screenshot({ path: join(run.directory, 'web-persisted.png') })
    })
    await check('TF08-initialization-retry', async () => {
      const retry = await webContexts[0].newPage()
      retry.on('pageerror', error => pageErrors.push(error.message))
      await retry.route('**/api/config', route => route.fulfill({ status: 500, body: 'Injected initial failure' }), { times: 1 })
      await retry.goto(webBase, { waitUntil: 'domcontentloaded' })
      const button = retry.getByRole('button', { name: /Retry|重试/, exact: true }); await button.waitFor()
      await button.focus(); await retry.keyboard.press('Tab'); await retry.keyboard.press('Shift+Tab'); visibleFocus(await focus(retry, 'button:focus'))
      await retry.keyboard.press('Enter'); await ready(retry); await applied(retry, 'ink', 'light', 'system'); await retry.close()
    })
    // Real user-file watcher → RPC broadcast → both production WebUI providers.
    const themesDir = join(config, 'themes'), livePath = join(themesDir, 'watcher-theme.json')
    const definition = JSON.stringify({ name: 'Watcher theme', accent: '#5438bb', background: '#fffafa' })
    const revision = () => first.locator('html').getAttribute('data-theme-revision')
    const errorState = async () => {
      for (const target of [first, second]) await target.waitForFunction(() => document.documentElement.dataset.themeStatus === 'error'
        && !document.documentElement.dataset.theme && !document.documentElement.dataset.scenic, null, { timeout: 15_000 })
    }
    await first.evaluate(() => { window.themeWatchEvents = []; window.electronAPI.onUserThemesChanged(value => window.themeWatchEvents.push(value)) })
    await check('TC10-real-select', async () => {
      writeFileSync(livePath, definition)
      await second.evaluate(() => window.electronAPI.setThemePreferences({ mode: 'light', colorTheme: 'watcher-theme', font: 'system' }))
      await applied(first, 'watcher-theme', 'light', 'system'); await applied(second, 'watcher-theme', 'light', 'system')
    })
    await check('TC10-real-unrelated', async () => {
      const before = await revision(), calls = transport.filter((value: any) => value.client === 0 && value.direction === 'send' && value.channel === RPC_CHANNELS.theme.LOAD_PRESET).length
      writeFileSync(join(themesDir, 'other-theme.json'), JSON.stringify({ name: 'Unrelated', accent: '#123456' }))
      await first.waitForFunction(() => window.themeWatchEvents.some(value => value.themeId === 'other-theme'))
      assert.equal(await revision(), before)
      assert.equal(transport.filter((value: any) => value.client === 0 && value.direction === 'send' && value.channel === RPC_CHANNELS.theme.LOAD_PRESET).length, calls)
    })
    await check('TC10-real-partial-write', async () => { writeFileSync(livePath, '{"name":'); await errorState() })
    await check('TC10-real-atomic-repair', async () => {
      const temp = join(themesDir, 'replacement.tmp'); writeFileSync(temp, definition); renameSync(temp, livePath)
      await applied(first, 'watcher-theme', 'light', 'system'); await applied(second, 'watcher-theme', 'light', 'system')
    })
    await check('TC10-real-delete', async () => { unlinkSync(livePath); await errorState() })
    await check('TC10-real-restore', async () => { writeFileSync(livePath, definition); await applied(first, 'watcher-theme', 'light', 'system') })
    const renamed = join(themesDir, 'renamed-theme.json')
    await check('TC10-real-rename', async () => { renameSync(livePath, renamed); await errorState() })
    await check('TC10-real-rename-back', async () => { renameSync(renamed, livePath); await applied(first, 'watcher-theme', 'light', 'system') })
    await check('TC10-real-offline-file-event', async () => {
      const before = await revision()
      try {
        await webContexts[0].setOffline(true); await first.evaluate(() => window.electronAPI.reconnectTransport())
        await waitForBrowserCondition(first, async () => (await window.electronAPI.getTransportConnectionState()).status !== 'connected')
        writeFileSync(livePath, JSON.stringify({ name: 'Watcher theme', accent: '#723f9e', background: '#fffafa' }))
        await second.waitForFunction(before => document.documentElement.dataset.themeStatus === 'ready' && document.documentElement.dataset.themeRevision !== before, before)
      } finally { await webContexts[0].setOffline(false); await first.evaluate(() => window.electronAPI.reconnectTransport()) }
      await first.waitForFunction(before => document.documentElement.dataset.themeStatus === 'ready' && document.documentElement.dataset.themeRevision !== before, before)
    })
    const imageBytes = await first.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#20232c'; ctx.fillRect(0, 0, 2, 2); const dark = canvas.toDataURL('image/png').split(',')[1]!
      ctx.fillStyle = '#94601c'; ctx.fillRect(0, 0, 2, 2); return { dark, amber: canvas.toDataURL('image/png').split(',')[1]! }
    })
    const scenicPath = join(themesDir, 'watcher-scenic.json'), assetPath = join(themesDir, 'scene.png')
    let imageRevision: string | null
    await check('TC05-real-scenic', async () => {
      writeFileSync(assetPath, Buffer.from(imageBytes.dark, 'base64'))
      writeFileSync(scenicPath, JSON.stringify({ name: 'Watcher scenic', accent: '#5438bb', mode: 'scenic', backgroundImage: 'scene.png' }))
      await second.evaluate(() => window.electronAPI.setThemePreferences({ mode: 'light', colorTheme: 'watcher-scenic', font: 'system' }))
      await applied(first, 'watcher-scenic', 'dark', 'system'); await applied(second, 'watcher-scenic', 'dark', 'system')
      assert.equal(await first.locator('html').getAttribute('data-scenic'), 'true'); imageRevision = await revision()
    })
    await check('TC05-real-image-update', async () => {
      writeFileSync(assetPath, Buffer.from(imageBytes.amber, 'base64'))
      await first.waitForFunction(before => document.documentElement.dataset.themeStatus === 'ready' && document.documentElement.dataset.themeRevision !== before, imageRevision!, { timeout: 5000 })
    })
    await check('TC05-real-image-corrupt', async () => { writeFileSync(assetPath, 'invalid pixels'); await errorState() })
    await check('TC05-real-image-repair', async () => {
      writeFileSync(assetPath, Buffer.from(imageBytes.dark, 'base64')); await applied(first, 'watcher-scenic', 'dark', 'system')
    })
    await check('TC05-real-path-escape', async () => {
      writeFileSync(join(config, 'outside.png'), Buffer.from(imageBytes.dark, 'base64'))
      writeFileSync(scenicPath, JSON.stringify({ name: 'Watcher scenic', accent: '#5438bb', mode: 'scenic', backgroundImage: '../outside.png' })); await errorState()
      assert.equal(await first.locator('html').evaluate(element => (element as HTMLElement).style.getPropertyValue('--background-image')), '')
    })
    samples.push({ watcher: { events: await first.evaluate(() => window.themeWatchEvents), themeFileSha256: sha256(scenicPath) } })
    await webContexts[0].tracing.stop({ path: join(run.directory, 'web-trace.zip') })
    await Promise.all(webContexts.map(context => context.close()))
    await check('TF18-no-pageerror', async () => assert.deepEqual(pageErrors, []))
    run.complete(checks.filter(check => check.passed).map(check => check.id), [
      'Formal Electron packages and native material/caption/BrowserView', 'macOS/Linux execution',
      'Physical touch devices, mobile Safari and soft keyboard', 'Watcher process restart and events lost while a client is offline',
      'Contrast/token parity and Viewer Shiki are in theme-contract; visual parameter changes (W3)',
    ])
    assert(checks.every(check => check.passed), JSON.stringify(checks.filter(check => !check.passed)))
  } finally {
    run.json('theme-foundation.json', { checks, samples, pageErrors, transport, browser: launched.browser.version(),
      boundary: 'Four real CSS entries + production controls/resolver; real authenticated WebUI bundle/server with isolated config. CSS wrappers only register fixture class sources before Tailwind compiles.' })
    await context.tracing.stop({ path: join(run.directory, 'controls-trace.zip') })
    await launched.close(); await server.close(); await child?.stop()
    if (child) run.json('server-output.json', { stdout: child.stdout(), stderr: child.stderr() })
  }
})

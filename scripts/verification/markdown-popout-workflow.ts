/** MP01–MP12 browser workflow. Authored before the popout card restoration. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('markdown-popout', async run => {
  const root = resolve(import.meta.dir, '../..')
  writeFileSync(join(run.directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/markdown-popout.tsx"></script></body></html>')
  const server = await createServer({ configFile: resolve(root, 'apps/electron/vite.config.ts'), root,
    server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/runtimes/**', `${run.directory}/**`] } } })
  await server.listen()
  const port = (server.httpServer!.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}/${relative(root, run.directory).replaceAll('\\', '/')}/index.html`
  const launched = await launchWorkflowBrowser()
  const page = await launched.browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = [], consoleErrors: string[] = []
  const checks: { id: string; passed: boolean; error?: string }[] = [], geometry: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.context().tracing.start({ screenshots: true, snapshots: true })
  async function check(id: string, fn: () => Promise<void>) {
    try { await fn(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  async function load(width = 1440, mode: 'light' | 'dark' = 'light') {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.popoutFixture?.ready)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(mode => window.popoutFixture.setMode(mode), mode)
    await page.waitForFunction(mode => document.documentElement.classList.contains(mode), mode)
  }
  async function open(kind: string) {
    await page.getByTestId(`open-${kind}`).click()
    await page.getByRole('dialog').waitFor()
    await page.waitForTimeout(250)
  }
  async function card() {
    return page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[role="dialog"] .shadow-strong')
      if (!target) return null
      const dialog = target.closest<HTMLElement>('[role="dialog"]')!, c = target.getBoundingClientRect(), d = dialog.getBoundingClientRect()
      const css = getComputedStyle(target), bg = getComputedStyle(dialog)
      const scrolls = []
      for (let node: HTMLElement | null = target; node && node !== dialog; node = node.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1)
          scrolls.push({ client: node.clientHeight, scroll: node.scrollHeight })
      }
      return { x: c.x, y: c.y, width: c.width, height: c.height, centerX: c.x + c.width / 2, centerY: c.y + c.height / 2,
        dialog: { x: d.x, y: d.y, width: d.width, height: d.height }, radius: css.borderRadius, shadow: css.boxShadow,
        background: css.backgroundColor, canvas: bg.backgroundColor, scrolls }
    })
  }
  function requireCard(sample: Awaited<ReturnType<typeof card>>) {
    assert(sample, 'Content must have a separate card')
    assert(parseFloat(sample.radius) > 0, 'Card must be rounded')
    assert.notEqual(sample.shadow, 'none', 'Card border/elevation must be visible')
    assert.notEqual(sample.background, sample.canvas, 'Card and canvas must have distinct surfaces')
    assert(Math.abs(sample.centerX - (sample.dialog.x + sample.dialog.width / 2)) <= 2, 'Card must be horizontally centered')
    assert(sample.x >= sample.dialog.x && sample.x + sample.width <= sample.dialog.x + sample.dialog.width + 1, 'Card must stay inside the viewport')
  }
  async function capture(name: string) {
    const sample = await card(); geometry.push({ name, sample })
    await page.screenshot({ path: join(run.directory, `${name}.png`) })
    return sample
  }
  try {
    for (const mode of ['light', 'dark'] as const) for (const kind of ['message', 'response', 'turn', 'activity']) {
      await check(`MP01-${mode}-${kind}`, async () => {
        await load(1440, mode); await open(kind)
        const sample = await capture(`${kind}-${mode}`); requireCard(sample)
        assert(sample!.width <= 960 && sample!.width >= 700)
        assert(Math.abs(sample!.centerY - 450) <= 100, 'Short card must be vertically centered')
      })
    }
    await check('MP02-MP03-source', async () => {
      await load(); await open('source')
      const sample = await capture('source-light'); requireCard(sample)
      await page.locator('.shiki').waitFor()
      const text = await page.locator('.shiki').innerText()
      assert(text.startsWith('# 你好！')); assert(text.includes('**保留源码标记**'))
      await page.getByText('response.md', { exact: true }).waitFor()
      await page.getByText('Read', { exact: true }).waitFor()
      assert.equal(await page.locator('[role="dialog"] h1').count(), 0, 'Source must remain literal Markdown')
      assert(await page.locator('.sticky').innerText().then(text => text.includes('1') && text.includes('10')), 'Line numbers must be present')
      await page.screenshot({ path: join(run.directory, 'source-light.png') })
    })
    await check('MP03-formatted', async () => {
      await load(); await open('response'); requireCard(await card())
      assert.equal(await page.getByRole('heading', { name: 'Response', exact: true }).count(), 1)
      assert.equal(await page.locator('[role="dialog"] strong').innerText(), '格式化')
    })
    await check('MP04-desktop-pane', async () => {
      await load(1100); await open('message'); requireCard(await capture('message-1100'))
    })
    await check('MP05-open-source-theme-switch', async () => {
      await load(); await open('source'); requireCard(await card()); await page.locator('.shiki.github-light').waitFor()
      const before = await card()
      await page.evaluate(() => window.popoutFixture.setMode('dark'))
      await page.locator('.shiki.github-dark').waitFor(); await page.waitForTimeout(400)
      const after = await capture('source-dark'); requireCard(after)
      assert.notEqual(before!.background, after!.background)
    })
    for (const kind of ['message', 'source']) await check(`MP06-mobile-${kind}`, async () => {
      await load(390); await open(kind); requireCard(await capture(`${kind}-390`))
      const dimensions = await page.getByRole('dialog').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }))
      assert(dimensions.scroll <= dimensions.width + 1, 'Outer preview must not scroll horizontally')
    })
    for (const kind of ['long', 'long-source']) await check(`MP07-${kind}`, async () => {
      await load(1100); await open(kind); const sample = await capture(kind); requireCard(sample)
      assert.equal(sample!.scrolls.length, 1, 'Long content must use a single outer vertical scroll')
      const result = await page.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        const card = dialog.querySelector<HTMLElement>('.shadow-strong')!
        let parent = card.parentElement!
        while (parent !== dialog && parent.scrollHeight <= parent.clientHeight + 1) parent = parent.parentElement!
        parent.scrollTop = 0; const top = parent.scrollTop
        parent.scrollTop = parent.scrollHeight; const bottom = parent.scrollTop
        return { top, bottom, max: parent.scrollHeight - parent.clientHeight, text: card.innerText }
      })
      assert.equal(result.top, 0); assert(result.bottom > 0 && Math.abs(result.bottom - result.max) <= 1)
      assert(result.text.includes(kind === 'long' ? 'END OF DOCUMENT' : 'END OF SOURCE'))
      await page.screenshot({ path: join(run.directory, `${kind}-end.png`) })
    })
    await check('MP08-close-escape-replace', async () => {
      await load(); await open('message')
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await page.getByTestId('open-message').evaluate(element => document.activeElement === element), true)
      await open('response')
      await page.evaluate(() => window.popoutFixture.replace('activity'))
      await page.getByRole('heading', { name: 'Read', exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Response', exact: true }).count(), 0)
      await page.getByRole('button', { name: /关闭|close/i }).click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    })
    await check('MP09-link-callbacks', async () => {
      await load(); await open('links')
      await page.getByRole('link', { name: '打开网页' }).click()
      await page.getByRole('link', { name: '打开文件' }).click()
      const callbacks = await page.evaluate(() => window.popoutFixture.callbacks)
      assert.deepEqual(callbacks, [{ type: 'url', value: 'https://example.test/audit' }, { type: 'file', value: '/fixture/response.md' }])
    })
    assert.equal(errors.length, 0, errors.join('\n')); assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'))
    run.complete(checks.filter(check => check.passed).map(check => check.id), [
      'Real ChatDisplay/host boot and persisted session integration (call sites reviewed and typechecked)',
      'Native Electron package, macOS material, Windows/Linux execution', 'Signed installer/release',
      'Modal branch: current modalBreakpoint=99999; all tested viewports use fullscreen',
    ])
    assert(checks.every(check => check.passed), JSON.stringify(checks.filter(check => !check.passed)))
  } finally {
    run.json('markdown-popout.json', { checks, geometry, errors, consoleErrors, browser: launched.browser.version(),
      viewportModes: 'actual fullscreen at 1440/1100/390; current modalBreakpoint=99999' })
    await page.context().tracing.stop({ path: join(run.directory, 'trace.zip') })
    await launched.close(); await server.close()
    console.log(JSON.stringify({ output: run.directory, passed: checks.filter(check => check.passed).length, total: checks.length }))
  }
})

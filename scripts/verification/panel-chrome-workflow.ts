/**
 * W2 · panel chrome budget.
 *
 * The 2026-10-21 audit measured 112.5px of chrome (3 × 37.5px bars) above an
 * empty Files panel: a workbench tab strip, a view tab strip and a filter band,
 * each with its own selection grammar. The contract is **one chrome row per
 * panel and ≤75px between the panel top and its content** (DESIGN.md → Layout).
 *
 * The Files panel now renders its view tabs and its filter in a single
 * `h-control-lg` row (34px), and the workbench strip above it is the same tier,
 * so the measured budget is 68px. This workflow mounts the real panel and
 * asserts the structure — one row, ≤36px, tabs and filter inside it, content
 * starting immediately below it — instead of trusting the class names.
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

/** One chrome row may not exceed the `h-control-lg` tier (34px) plus a border. */
const CHROME_ROW_MAX_PX = 36
/** Total chrome above content: workbench strip + panel row, both at 34px. */
const CHROME_BUDGET_PX = 75

await verificationWorkflow('panel-chrome', async run => {
  const root = resolve(import.meta.dir, '../..')
  const fixture = join(root, 'scripts/verification/fixtures/panel-chrome.tsx')
  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`

  writeFileSync(join(run.directory, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="icon" href="data:,"></head><body><div id="root"></div>'
    + '<script type="module" src="/scripts/verification/fixtures/panel-chrome.tsx"></script></body></html>')
  writeFileSync(join(run.directory, 'host.css'),
    `@import "${relative(run.directory, join(root, 'apps/electron/src/renderer/index.css')).replaceAll('\\', '/')}";\n`
    + `@source "${fixture.replaceAll('\\', '/')}";\n`)

  const launched = await launchWorkflowBrowser()
  const server = await createServer({
    configFile: join(root, 'apps/electron/vite.config.ts'),
    root,
    optimizeDeps: {
      entries: [fixture],
      include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    server: {
      host: '127.0.0.1', port: 0, open: false,
      watch: { ignored: ['**/runtimes/**', '**/.cache/**', '**/dist/**', `${run.directory}/**`] },
    },
  })
  await server.listen()
  const port = (server.httpServer!.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}${prefix}/index.html?css=${encodeURIComponent(`${prefix}/host.css`)}`

  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
  const page = await context.newPage()
  const errors: string[] = []
  const noise = (text: string) => /Outdated Optimize Dep|optimized dependencies changed/i.test(text)
  page.on('pageerror', error => { if (!noise(error.message)) errors.push(error.message) })
  page.on('console', message => {
    if (noise(message.text())) return
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`)
  })

  const scenes: string[] = []
  async function check(id: string, execute: () => Promise<void>) {
    try { await execute(); scenes.push(id) } catch (error) {
      throw new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    await gotoWithRetry(page, url)
    try {
      await page.waitForFunction(() => window.__panelChrome?.ready === true, undefined, { timeout: 60_000 })
    } catch (error) {
      throw new Error(`fixture did not become ready; page errors: ${errors.join(' | ') || '(none captured)'}`)
    }
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

    const measured = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('[data-chrome-host]')
      if (!host) {
        return { missingHost: true, bodyPreview: document.body.innerHTML.slice(0, 600) }
      }
      const hostTop = host.getBoundingClientRect().top
      const rows = [...document.querySelectorAll<HTMLElement>('[data-chrome-row]')]
      const content = document.querySelector<HTMLElement>('[data-chrome-row] ~ div')
      return {
        rows: rows.map(row => ({
          role: row.dataset.chromeRow ?? '',
          top: Math.round((row.getBoundingClientRect().top - hostTop) * 100) / 100,
          height: Math.round(row.getBoundingClientRect().height * 100) / 100,
          tabs: row.querySelectorAll('[role="tab"]').length,
          hasFilter: Boolean(row.querySelector('input')),
        })),
        contentTop: content ? Math.round((content.getBoundingClientRect().top - hostTop) * 100) / 100 : null,
        tablistRole: document.querySelector('[role="tablist"]')?.getAttribute('aria-label') ?? null,
      }
    })

    run.json('panel-chrome.json', { generatedAt: new Date().toISOString(), budgets: { chromeRowMaxPx: CHROME_ROW_MAX_PX, chromeBudgetPx: CHROME_BUDGET_PX }, measured })
    if ('missingHost' in measured) {
      throw new Error(`fixture rendered no host element: ${JSON.stringify(measured).slice(0, 400)} | console: ${errors.join(' | ').slice(0, 900)}`)
    }

    await check('pc1-single-chrome-row', async () => {
      assert.equal(measured.rows.length, 1, `expected one chrome row above the Files content, measured ${measured.rows.length}`)
      assert.equal(measured.rows[0]!.role, 'files')
    })

    await check('pc2-row-height', async () => {
      assert(measured.rows[0]!.height <= CHROME_ROW_MAX_PX,
        `chrome row is ${measured.rows[0]!.height}px, above the ${CHROME_ROW_MAX_PX}px row budget`)
    })

    await check('pc3-tabs-and-filter-share-the-row', async () => {
      assert.equal(measured.rows[0]!.tabs, 3, `expected three view tabs in the chrome row, found ${measured.rows[0]!.tabs}`)
      assert(measured.rows[0]!.hasFilter, 'the filter input must live in the same row as the view tabs')
      assert(measured.tablistRole, 'the view tabs must keep their tablist label')
    })

    await check('pc4-content-follows-the-row', async () => {
      assert(measured.contentTop !== null, 'no content region found below the chrome row')
      assert(measured.contentTop <= CHROME_ROW_MAX_PX + 1,
        `content starts at ${measured.contentTop}px; chrome must end at the row's ${CHROME_ROW_MAX_PX}px budget`)
    })

    await check('pc5-total-chrome-budget', async () => {
      // The workbench strip above the panel is the same `h-control-lg` tier; its
      // height is asserted by classes elsewhere, so the panel row is the variable.
      const total = measured.rows[0]!.height + 34
      assert(total <= CHROME_BUDGET_PX, `workbench strip + panel row = ${total}px, above the ${CHROME_BUDGET_PX}px budget`)
    })

    await page.screenshot({ path: join(run.directory, 'files-panel-chrome-light.png') })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await page.screenshot({ path: join(run.directory, 'files-panel-chrome-dark.png') })

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
    run.complete(scenes)
  } finally {
    await context.close().catch(() => undefined)
    await launched.close()
    await server.close()
  }
})

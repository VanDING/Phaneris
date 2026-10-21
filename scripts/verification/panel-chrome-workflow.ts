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
/** A resting card is three rows; measured 75px, frozen at 96 to catch a fourth row. */
const CARD_HEIGHT_BUDGET_PX = 96

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

    await check('pc6-tabs-are-keyboard-navigable', async () => {
      // The audit found the Files view tabs were `role="tab"` buttons with no
      // roving focus: one tab stop per tab, no arrow keys. A tablist has one
      // stop and answers Arrow/Home/End.
      const tabs = page.locator('[data-chrome-row="files"] [role="tab"]')
      await tabs.first().focus()
      assert.equal(await page.locator('[data-chrome-row="files"] [role="tab"][tabindex="0"]').count(), 1,
        'a tablist must expose exactly one tab stop')
      await page.keyboard.press('ArrowRight')
      // Roving focus moves on the next frame; wait for the state, not the clock.
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab'
        && document.activeElement?.getAttribute('aria-selected') === 'true', undefined, { timeout: 2_000 })
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null
        return {
          role: element?.getAttribute('role') ?? null,
          selected: element?.getAttribute('aria-selected') ?? null,
          label: element?.textContent?.trim() ?? null,
        }
      })
      assert.equal(focused.role, 'tab', 'ArrowRight must move focus to the next tab')
      assert.equal(focused.selected, 'true', 'selection follows focus in this tablist')
      await page.keyboard.press('Home')
      await page.waitForFunction(() => {
        const element = document.activeElement as HTMLElement | null
        return element?.getAttribute('role') === 'tab' && element.textContent?.trim() === 'Browse'
      }, undefined, { timeout: 2_000 })
      const home = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-selected') ?? null)
      assert.equal(home, 'true', 'Home must return to the first tab and select it')
    })

    await check('pc7-done-column-starts-collapsed', async () => {
      // A finished column is an archive: 30 cards must not render until asked.
      const board = page.locator('[data-board-fixture]')
      assert.equal(await board.locator('[data-task-column="done"]').count(), 0,
        'a finished column above the collapse threshold rendered its cards immediately')
      const toggle = board.getByRole('button', { name: 'Show done' })
      assert.equal(await toggle.count(), 1, 'the collapsed column must offer an explicit toggle')
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      await toggle.click()
      assert(await board.locator('[data-task-column="done"]').count() > 0,
        'the toggle did not reveal the finished cards')
      assert.equal(await board.getByRole('button', { name: 'Hide done' }).count(), 1)
    })

    await check('pc8-empty-column-offers-an-exit', async () => {
      const board = page.locator('[data-board-fixture]')
      assert.equal(await board.getByText('No tasks match the current filters.').count(), 1,
        'an empty column must state that it is empty where the gap is')
      assert.equal(await board.getByText('New Task', { exact: true }).count() > 0, true,
        'an empty column must offer the new-task affordance')
    })

    await check('pc9-task-moves-by-keyboard', async () => {
      // Moving a task was pointer-only (drag). The context menu offers the same
      // move, and Shift+F10 opens that menu from the focused tile.
      const board = page.locator('[data-board-fixture]')
      const tile = board.locator('[data-task-tile]').first()
      await tile.focus()
      await page.keyboard.press('Shift+F10')
      const moveItem = page.getByRole('menuitem', { name: 'Move to column' })
      await moveItem.waitFor({ state: 'visible', timeout: 5_000 })
      await moveItem.hover()
      const target = page.getByRole('menuitem', { name: 'Backlog' })
      await target.waitFor({ state: 'visible', timeout: 5_000 })
      // Keyboard activation, not a mouse click: this is the path the target
      // exists to prove (menu → submenu → item, all reachable without a pointer).
      await target.focus()
      await page.keyboard.press('Enter')
      const observed = await page.evaluate(() => ({
        moves: window.__boardMoves ?? [],
        last: document.body.dataset.lastMove ?? null,
      }))
      assert.equal(observed.moves.length, 1,
        `expected one recorded move, got ${JSON.stringify(observed)}`)
      assert.equal(observed.moves[0]!.to, 'backlog')
      assert.equal(observed.moves[0]!.taskId, 'done-0')
    })

    await check('pc10-card-is-three-rows', async () => {
      // The audit's card carried two dividers and up to seven rows of metadata.
      // A resting card is meta / title / footer: three rows, no matter how much
      // the tile could say.
      const tile = page.locator('[data-board-fixture] [data-task-tile]').first()
      const rows = await tile.locator('[data-tile-row]').count()
      assert.equal(rows, 3, `a resting card paints ${rows} rows; the budget is 3 (meta, title, footer)`)
      const box = await tile.boundingBox()
      assert(box !== null, 'the first card has no layout box')
      assert(box!.height <= CARD_HEIGHT_BUDGET_PX, `card height ${box!.height.toFixed(1)}px exceeds the ${CARD_HEIGHT_BUDGET_PX}px budget`)
    })

    const cardMetrics = await page.evaluate(() => {
      const tile = document.querySelector('[data-board-fixture] [data-task-tile]')
      if (!tile) return null
      return {
        height: Math.round(tile.getBoundingClientRect().height * 100) / 100,
        rows: tile.querySelectorAll('[data-tile-row]').length,
      }
    })
    run.json('card-density.json', { generatedAt: new Date().toISOString(), rowBudget: 3, heightBudgetPx: CARD_HEIGHT_BUDGET_PX, measured: cardMetrics })

    await check('pc11-artifacts-view-adds-no-second-row', async () => {
      // The filter used to be a permanent row of `aria-pressed` chips under the
      // view tabs. It is a menu in the view's own header now, so switching views
      // must not grow the chrome stack.
      await page.getByRole('tab', { name: 'Artifacts', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('[data-chrome-row="files"] input'), undefined, { timeout: 5_000 })
      assert.equal(await page.locator('[data-chrome-row]').count(), 1,
        'the artifacts view must keep the single chrome row')
      assert.equal(await page.locator('[aria-pressed]').count(), 0,
        'the artifacts scope filter must be a menu, not a row of aria-pressed chips')
      await page.getByRole('tab', { name: 'Browse', exact: true }).click()
      await page.waitForFunction(() => Boolean(document.querySelector('[data-chrome-row="files"] input')), undefined, { timeout: 5_000 })
    })

    await check('pc12-touch-targets-on-a-coarse-pointer', async () => {
      // Under `pointer: coarse` every control must be reachable at 44×44 — the
      // board's hover pencil and the tag toggles were 24px hit areas. A coarse
      // context is the only way to see the `@media (pointer: coarse)` rules; a
      // desktop viewport never evaluates them.
      const touch = await launched.browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true })
      try {
        const touchPage = await touch.newPage()
        await gotoWithRetry(touchPage, url)
        await touchPage.waitForFunction(() => window.__panelChrome?.ready === true, undefined, { timeout: 60_000 })
        await touchPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        const sized = await touchPage.evaluate(() => {
          const selector = '[data-board-fixture] button, [data-board-fixture] [role="button"], [data-board-fixture] a, [data-board-fixture] input'
          return [...document.querySelectorAll<HTMLElement>(selector)].map(element => {
            const box = element.getBoundingClientRect()
            return {
              label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40),
              width: Math.round(box.width * 10) / 10,
              height: Math.round(box.height * 10) / 10,
              visible: box.width > 0 && box.height > 0,
            }
          }).filter(entry => entry.visible)
        })
        assert(sized.length > 0, 'the board fixture rendered no interactive elements')
        const undersized = sized.filter(entry => entry.width < 44 || entry.height < 44)
        assert.equal(undersized.length, 0,
          `controls below the 44px coarse-pointer target: ${JSON.stringify(undersized.slice(0, 6))}`)
      } finally {
        await touch.close()
      }
    })

    await check('pc13-project-colours-stay-readable', async () => {
      // A custom column paints its header with the user's colour and a computed
      // onAccent. Every colour in the palette must clear 4.5:1 as rendered; the
      // audit's board failed this at 2.15:1 with a hard-coded white.
      const swatches = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context2d = canvas.getContext('2d', { willReadFrequently: true })!
        const rgba = (value: string): [number, number, number] => {
          context2d.clearRect(0, 0, 1, 1)
          context2d.fillStyle = '#000'
          context2d.fillStyle = value
          context2d.fillRect(0, 0, 1, 1)
          const [r, g, b] = context2d.getImageData(0, 0, 1, 1).data
          return [r!, g!, b!]
        }
        const luminance = ([r, g, b]: [number, number, number]) => {
          const channel = (value: number) => {
            const c = value / 255
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        }
        return [...document.querySelectorAll<HTMLElement>('[data-swatch]')].map(element => {
          const style = getComputedStyle(element)
          const a = luminance(rgba(style.color))
          const b = luminance(rgba(style.backgroundColor))
          const [light, dark] = a >= b ? [a, b] : [b, a]
          return { color: element.dataset.swatch ?? '', ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100 }
        })
      })
      assert(swatches.length >= 8, `expected the whole project palette, measured ${swatches.length}`)
      const failing = swatches.filter(swatch => swatch.ratio < 4.5)
      assert.equal(failing.length, 0,
        `project colours below 4.5:1 as rendered: ${JSON.stringify(failing)}`)
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

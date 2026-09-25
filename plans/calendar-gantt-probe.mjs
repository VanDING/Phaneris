/**
 * Diagnostic probe: does the Playground actually render the calendar and gantt
 * projections, and if not, which `electronAPI` member is missing?
 *
 * Read-only: it observes console output and DOM state, and injects nothing that
 * changes product code. Results are written to plans/calendar-gantt-probe.json.
 *
 * Usage (start the renderer dev server first):
 *   cd apps/electron && bun run dev
 *   node plans/calendar-gantt-probe.mjs http://localhost:5199
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5199'
const outputPath = 'plans/calendar-gantt-probe.json'

const browser = await chromium.launch({ headless: true })
const report = { base, browser: browser.version(), date: new Date().toISOString(), views: {} }

/** Opens the Playground pinned to one component and reports what actually rendered. */
async function probe(componentId) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const consoleMessages = []
  const pageErrors = []
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)))

  await page.addInitScript((id) => {
    localStorage.setItem('playground-selected-component', id)
    localStorage.setItem('playground-preview-size', JSON.stringify({ width: 1280, height: 800 }))
    localStorage.setItem('playground-variants-sidebar-open', 'false')
    localStorage.setItem('playground-motion-preference', 'system')
    localStorage.setItem('i18nextLng', 'en')
  }, componentId)

  const result = { componentId, consoleMessages: [], pageErrors: [], domNodes: 0, markers: {}, crashed: null }
  try {
    await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    // Give the mock + providers time to mount, or to throw.
    await page.waitForTimeout(4000)

    const observed = await page.evaluate(() => {
      const text = document.body.innerText
      return {
        domNodes: document.querySelectorAll('*').length,
        hasLoader: Boolean(document.querySelector('#_loader')),
        bodyTextHead: text.slice(0, 700),
        // Error-boundary / crash surfaces the app renders instead of the view.
        errorBoundary: document.querySelector('[data-surface-error]')?.textContent?.slice(0, 300) ?? null,
        // View-specific landmarks.
        gantt: {
          host: Boolean(document.querySelector('.phaneris-gantt')),
          bars: document.querySelectorAll('.wx-bar').length,
          rows: document.querySelectorAll('.wx-row').length,
          scaleCells: document.querySelectorAll('.wx-cell').length,
        },
        calendar: {
          timeGrid: document.querySelectorAll('[data-time-grid]').length,
          entries: document.querySelectorAll('[data-calendar-entry]').length,
          gridCells: document.querySelectorAll('[class*="grid-rows-"]').length,
        },
        weekLabels: [...document.querySelectorAll('.wx-cell')]
          .map((node) => node.textContent?.trim() ?? '')
          .filter((value) => /^W\d+$|^\d+$/.test(value))
          .slice(0, 40),
      }
    })
    Object.assign(result, observed)
    result.consoleMessages = consoleMessages.slice(0, 40)
    result.pageErrors = pageErrors.slice(0, 20)
  } catch (error) {
    result.crashed = String(error?.message ?? error)
    result.consoleMessages = consoleMessages.slice(0, 40)
    result.pageErrors = pageErrors.slice(0, 20)
  } finally {
    await page.close()
  }
  return result
}

for (const id of ['calendar-view', 'gantt-view', 'work-item-board-view']) {
  report.views[id] = await probe(id)
  const view = report.views[id]
  const summary = view.crashed
    ? `CRASHED: ${view.crashed}`
    : `nodes=${view.domNodes} pageErrors=${view.pageErrors.length}`
  console.log(`\n=== ${id} === ${summary}`)
  if (view.pageErrors?.length) for (const error of view.pageErrors.slice(0, 4)) console.log(`   pageError: ${error}`)
  if (view.calendar) console.log(`   calendar: gridCells=${view.calendar.gridCells} entries=${view.calendar.entries} timeGrid=${view.calendar.timeGrid}`)
  if (view.gantt) console.log(`   gantt: host=${view.gantt.host} bars=${view.gantt.bars} rows=${view.gantt.rows} weekLabels=${JSON.stringify(view.weekLabels?.slice(0, 8))}`)
  if (view.bodyTextHead) console.log(`   text: ${JSON.stringify(view.bodyTextHead.slice(0, 160))}`)
}

await mkdir('plans', { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nwrote ${outputPath}`)
await browser.close()

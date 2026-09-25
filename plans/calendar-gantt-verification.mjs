/**
 * Calendar / Gantt P0 verification — real views in a real browser.
 *
 * Every assertion observes the rendered DOM of the production components loaded
 * through the Playground (with its mock `electronAPI`), so nothing here asserts
 * source text. This is the repeatable artifact for the correctness work: run it
 * before and after a change and compare `plans/calendar-gantt-verification.json`.
 *
 * Usage (start the renderer dev server first — it binds IPv6, so use `localhost`):
 *   bun run vite dev --config apps/electron/vite.config.ts --port 5199 --strictPort
 *   node plans/calendar-gantt-verification.mjs http://localhost:5199
 *
 * What it pins, and why each check exists:
 *   1. Playground boots the Projects surface — `onSessionEvent` was missing from
 *      the mock, so every one of these views rendered an empty page.
 *   2. Bar width equals the INCLUSIVE day count. The adapter fed the timeline an
 *      exclusive `end` as if it were inclusive, so every multi-day bar drew one
 *      day short (5-day task → 4 cells, 161-day → 160).
 *   3. The row metadata shows the INCLUSIVE due date — the bar needs an exclusive
 *      boundary, but the label must not inherit it.
 *   4. Week headers are real ISO-8601 week numbers. The old formula disagreed
 *      with ISO for 53 of the 156 Mondays in 2025–2027.
 *   5. Undated items are visible (header count + drawer) instead of vanishing,
 *      and the scheduled count agrees with the number of bars drawn.
 *   6. The schedule editor surfaces a rejected write instead of closing silently.
 *   7. The Gantt task-list column is a share of the host rather than a constant,
 *      and a width the user dragged to survives a remount.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5199'
const outputPath = 'plans/calendar-gantt-verification.json'

const results = { date: new Date().toISOString(), base, browser: null, checks: [] }
await mkdir('plans', { recursive: true })

const browser = await chromium.launch({ headless: true })
results.browser = browser.version()

async function check(name, observation, run) {
  const record = { name, observation, status: 'pass', detail: null }
  try {
    await run()
  } catch (error) {
    record.status = 'fail'
    record.detail = error instanceof Error ? error.message : String(error)
  }
  results.checks.push(record)
  console.log(`${record.status === 'pass' ? 'PASS' : 'FAIL'}  ${name}${record.detail ? ` — ${record.detail}` : ''}`)
}

/** A Playground page pinned to one component, with console/page errors captured. */
async function openView(componentId, { width = 1400, height = 900, emptyWorkItems = false, previewWidth = 1400, query = '' } = {}) {
  const page = await browser.newPage({ viewport: { width, height } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)))
  await page.addInitScript(({ id, empty, preview }) => {
    if (empty) {
      // Patch the mock the moment it is installed, so the view reads an empty
      // projection on its first render. Reassigning `listWorkItems` after load
      // does not work: `ensureMockElectronAPI` installs it at module scope.
      let real
      Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        get: () => real,
        set: (value) => {
          real = value
          if (value && typeof value.listWorkItems === 'function') value.listWorkItems = async () => []
        },
      })
    }
    localStorage.setItem('playground-selected-component', id)
    localStorage.setItem('playground-preview-size', JSON.stringify({ width: preview, height: 860 }))
    localStorage.setItem('playground-variants-sidebar-open', 'false')
    localStorage.setItem('playground-motion-preference', 'system')
    localStorage.setItem('i18nextLng', 'en')
  }, { id: componentId, empty: emptyWorkItems, preview: previewWidth })
  await page.goto(`${base}/playground.html${query}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(3500)
  return { page, pageErrors }
}

/** Drags with real pointer events, the way the gestures under test are made. */
async function dragBetween(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) / steps) * step, from.y + ((to.y - from.y) / steps) * step)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  await page.waitForTimeout(900)
}

/** Whether the shared Task Definition editor is mounted over the surface. */
const editorIsOpen = (page) => page.locator('[data-task-editor-overlay]').count()

/** Clicks a control by its visible text, inside the page. */
const clickByText = (page, text) =>
  page.evaluate((label) => {
    const target = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)
    if (!target) throw new Error(`no button labelled "${label}"`)
    target.click()
    return true
  }, text)

/** Clicks a segmented-control option by its accessible name (`role=radio`). */
const selectRadio = (page, label) =>
  page.evaluate((wanted) => {
    const target = [...document.querySelectorAll('[role="radio"]')]
      .find((node) => node.textContent?.trim() === wanted)
    if (!target) throw new Error(`no radio labelled "${wanted}"`)
    target.click()
    return true
  }, label)

const measureGantt = (page) =>
  page.evaluate(() => {
    const bars = [...document.querySelectorAll('.wx-bar')].map((bar) => ({
      label: bar.querySelector('.pg-bar-label')?.textContent?.trim() ?? bar.textContent?.trim() ?? '',
      kind: bar.classList.contains('wx-summary')
        ? 'summary'
        : bar.classList.contains('wx-milestone')
          ? 'milestone'
          : 'task',
      width: Math.round(bar.getBoundingClientRect().width * 100) / 100,
    }))
    // Day-tier scale cells give the px-per-day the chart is currently using.
    const dayCells = [...document.querySelectorAll('.wx-scale .wx-cell')]
      .map((cell) => Math.round(cell.getBoundingClientRect().width * 100) / 100)
      .filter((width) => width > 0)
    const dayWidth = dayCells.length ? Math.min(...dayCells) : 0
    const rows = [...document.querySelectorAll('.pg-task-cell')].map((cell) => ({
      title: cell.querySelector('.pg-task-title-text')?.textContent?.trim() ?? '',
      meta: cell.querySelector('.pg-task-meta__date')?.textContent?.trim() ?? '',
    }))
    const weekLabels = [...document.querySelectorAll('.wx-scale .wx-cell')]
      .map((cell) => cell.textContent?.trim() ?? '')
      .filter((value) => /^W\d+$/.test(value))
    return { bars, dayWidth, rows, weekLabels, bodyText: document.body.innerText }
  })

// ---------------------------------------------------------------- playground ---
await check('Playground boots the Projects surface without page errors', 'no pageerror, DOM populated', async () => {
  const { page, pageErrors } = await openView('calendar-view')
  try {
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
    const nodes = await page.evaluate(() => document.querySelectorAll('*').length)
    assert.ok(nodes > 200, `expected a populated DOM, saw ${nodes} nodes (white screen)`)
  } finally {
    await page.close()
  }
})

// ------------------------------------------------------------------- gantt ---
/**
 * Task-list width. The previous `gridWidth={370}` was a constant chosen against
 * one window size: the column never moved when the window did, and a width the
 * user dragged to was forgotten on the next mount. Both halves are asserted here
 * — the adaptive default at two host widths, and the drag surviving a reload.
 */
const measureGridWidth = (page) => page.evaluate(() => {
  const host = document.querySelector('.phaneris-gantt')
  const grid = document.querySelector('.phaneris-gantt .wx-grid') ?? document.querySelector('.phaneris-gantt .wx-table')
  const resizer = document.querySelector('.phaneris-gantt .wx-resizer')
  const stored = Object.entries(localStorage)
    .filter(([key]) => key.includes('gantt-task-column-width'))
    .map(([, value]) => Number(value))
  return {
    host: Math.round(host?.getBoundingClientRect().width ?? 0),
    grid: Math.round(grid?.getBoundingClientRect().width ?? 0),
    resizerX: resizer ? Math.round(resizer.getBoundingClientRect().x) : null,
    stored: stored.filter((value) => Number.isFinite(value)),
  }
})

await check(
  'Gantt task-list width is a share of the host, not a constant',
  'host 1256 -> 376px, host 976 -> 292px (0.30 clamped to 280-560)',
  async () => {
    const wide = await openView('gantt-view', { previewWidth: 1280 })
    try {
      const at1280 = await measureGridWidth(wide.page)
      const narrow = await openView('gantt-view', { previewWidth: 1000 })
      try {
        const at1000 = await measureGridWidth(narrow.page)
        const expected = (host) => Math.min(560, Math.max(280, Math.round(host * 0.3)))
        assert.ok(
          Math.abs(at1280.grid - expected(at1280.host)) <= 2,
          `1280: grid ${at1280.grid} should be ~${expected(at1280.host)} of host ${at1280.host}`,
        )
        assert.ok(
          Math.abs(at1000.grid - expected(at1000.host)) <= 2,
          `1000: grid ${at1000.grid} should be ~${expected(at1000.host)} of host ${at1000.host}`,
        )
        assert.ok(
          at1000.grid < at1280.grid,
          `the column must follow the window: ${at1280.grid} -> ${at1000.grid}`,
        )
        assert.deepEqual(at1280.stored, [], 'nothing should be stored before the user drags')
      } finally {
        await narrow.page.close()
      }
    } finally {
      await wide.page.close()
    }
  },
)

await check(
  'A dragged task-list width is remembered across a remount',
  'drag +150px -> stored -> reload keeps it -> clearing it returns to adaptive',
  async () => {
    const { page } = await openView('gantt-view', { previewWidth: 1000 })
    try {
      const before = await measureGridWidth(page)
      const handle = await page.evaluate(() => {
        const node = document.querySelector('.phaneris-gantt .wx-resizer')
        if (!node) return null
        const box = node.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
      assert.ok(handle, 'the library splitter is missing, so no width can be dragged')
      await page.mouse.move(handle.x, handle.y)
      await page.mouse.down()
      for (let step = 1; step <= 12; step += 1) {
        await page.mouse.move(handle.x + (150 / 12) * step, handle.y)
        await page.waitForTimeout(16)
      }
      await page.mouse.up()
      await page.waitForTimeout(700)
      const dragged = await measureGridWidth(page)
      assert.ok(
        Math.abs(dragged.grid - (before.grid + 150)) <= 3,
        `dragging +150px moved the column from ${before.grid} to ${dragged.grid}`,
      )
      assert.ok(
        dragged.stored.some((value) => Math.abs(value - dragged.grid) <= 3),
        `the dragged width was not stored: ${JSON.stringify(dragged.stored)}`,
      )

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)
      const reloaded = await measureGridWidth(page)
      assert.ok(
        Math.abs(reloaded.grid - dragged.grid) <= 3,
        `a remount lost the width: ${dragged.grid} -> ${reloaded.grid}`,
      )

      // And a cleared preference goes back to following the window.
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.includes('gantt-task-column-width')) localStorage.removeItem(key)
        }
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)
      const cleared = await measureGridWidth(page)
      assert.ok(
        Math.abs(cleared.grid - before.grid) <= 3,
        `clearing the preference should restore the adaptive width: ${cleared.grid} vs ${before.grid}`,
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'The Gantt task cell fills its column, and keeps filling it after a drag',
  'cell width tracks .wx-content (354 at a 370px column, 544 at 560)',
  async () => {
    const { page } = await openView('gantt-view', { previewWidth: 1280 })
    try {
      /*
       * The library wraps a body cell's renderer in `.wx-text`, a flex item that sizes
       * to its CONTENT. A `width: 100%` on our own cell therefore resolves against a
       * content-sized box and the row stops following the column: measured before the
       * fix, a 370px column rendered a 197.72px row, so widening the task list moved
       * the divider and left the rows behind.
       */
      const measure = () => page.evaluate(() => {
        const round = (n) => Math.round(n * 100) / 100
        const width = (selector) => {
          const node = document.querySelector(selector)
          return node ? round(node.getBoundingClientRect().width) : null
        }
        return {
          grid: width('.phaneris-gantt .wx-grid'),
          content: width('.phaneris-gantt .wx-grid .wx-content'),
          cell: width('.phaneris-gantt .pg-task-cell'),
          text: width('.phaneris-gantt .wx-grid .wx-content > .wx-text'),
        }
      })

      const before = await measure()
      assert.ok(before.grid > 0 && before.content > 0, `could not measure the grid: ${JSON.stringify(before)}`)
      assert.ok(
        Math.abs(before.cell - before.content) <= 1,
        `the task cell must fill its content box: cell ${before.cell} vs content ${before.content}`,
      )

      const handle = await page.evaluate(() => {
        const node = document.querySelector('.phaneris-gantt .wx-resizer')
        if (!node) return null
        const box = node.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
      assert.ok(handle, 'the library splitter is missing')
      await page.mouse.move(handle.x, handle.y)
      await page.mouse.down()
      for (let step = 1; step <= 12; step += 1) {
        await page.mouse.move(handle.x + (200 / 12) * step, handle.y)
        await page.waitForTimeout(16)
      }
      await page.mouse.up()
      await page.waitForTimeout(700)

      const after = await measure()
      assert.ok(after.grid > before.grid, `the column did not widen: ${before.grid} -> ${after.grid}`)
      assert.ok(
        Math.abs(after.cell - after.content) <= 1,
        `the cell did not follow the widened column: cell ${after.cell} vs content ${after.content}`,
      )
      assert.ok(
        after.cell > before.cell + 100,
        `the row barely moved while the column grew: ${before.cell} -> ${after.cell}`,
      )
    } finally {
      await page.close()
    }
  },
)

await check('Gantt renders bars, rows and an ISO week scale', 'bars > 0 and week labels present', async () => {
  const { page, pageErrors } = await openView('gantt-view')
  try {
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
    const { bars } = await measureGantt(page)
    assert.ok(bars.length >= 4, `expected at least 4 bars, saw ${bars.length}`)
    await clickByText(page, 'Month')
    await page.waitForTimeout(1500)
    const measured = await measureGantt(page)
    assert.ok(measured.weekLabels.length > 0, 'no week labels rendered in the quarter scale')
    assert.ok(measured.dayWidth > 0, 'could not measure the day-cell width')
  } finally {
    await page.close()
  }
})

await check(
  'Bar width equals the inclusive day count (due day included)',
  'launch=5d, docs=6d, long=161d ± 0.5px',
  async () => {
    const { page } = await openView('gantt-view')
    try {
      await selectRadio(page, 'Month')
      await page.waitForTimeout(1500)
      const { bars, dayWidth } = await measureGantt(page)
      assert.ok(dayWidth > 0, 'day-cell width unavailable')
      const byLabel = Object.fromEntries(bars.map((bar) => [bar.label, bar]))
      // Fixture spans (inclusive): launch −12→−8 = 5d, docs −7→−2 = 6d, long −40→+120 = 161d.
      for (const [label, expectedDays] of [
        ['Prepare launch review', 5],
        ['Update integration guide', 6],
        ['Quarterly rollout', 161],
      ]) {
        const bar = byLabel[label]
        assert.ok(bar, `bar not found: ${label}`)
        const actualDays = bar.width / dayWidth
        assert.ok(
          Math.abs(actualDays - expectedDays) < 0.02,
          `${label}: expected ${expectedDays} days, measured ${actualDays.toFixed(3)} (${bar.width}px / ${dayWidth}px)`,
        )
      }
      // The old adapter drew one day short: 5→4 days, 161→160. Those ratios
      // (0.8 and 0.9938) are far outside the tolerance above, so this check
      // fails loudly if the exclusive-end contract regresses.
      const launchBar = byLabel['Prepare launch review']
      assert.ok(
        launchBar.width / dayWidth > 4.5,
        `5-day task rendered as ${launchBar.width / dayWidth} days — the exclusive-end bug is back`,
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'Row metadata shows the inclusive due date, not the exclusive boundary',
  'launch ends on due date, not due+1',
  async () => {
    const { page } = await openView('gantt-view')
    try {
      const { rows } = await measureGantt(page)
      const expected = await page.evaluate(() => {
        const fmt = new Intl.DateTimeFormat('en', { month: 'numeric', day: 'numeric' })
        const day = (offset) => {
          const date = new Date()
          date.setDate(date.getDate() + offset)
          return date
        }
        const range = (from, to) => `${fmt.format(day(from))}–${fmt.format(day(to))}`
        return {
          'Prepare launch review': range(-12, -8),
          'Update integration guide': range(-7, -2),
        }
      })
      for (const [title, want] of Object.entries(expected)) {
        const row = rows.find((entry) => entry.title === title)
        assert.ok(row, `row not found: ${title}`)
        assert.equal(row.meta, want, `${title}: metadata shows "${row.meta}", expected "${want}"`)
      }
    } finally {
      await page.close()
    }
  },
)

await check('Week headers are ISO-8601 week numbers', 'each label matches getISOWeek', async () => {
  const { page } = await openView('gantt-view')
  try {
    const { weekLabels } = await measureGantt(page)
    assert.ok(weekLabels.length > 0, 'no week labels to check')
    // Recompute ISO weeks independently (Thursday rule) for the visible window,
    // then assert every rendered label is one of them and that the rendered
    // sequence is contiguous — the old formula skipped and repeated weeks.
    const isoWeeks = await page.evaluate(() => {
      const weeks = []
      const cursor = new Date()
      cursor.setDate(cursor.getDate() - 90)
      for (let index = 0; index < 400; index += 1) {
        const date = new Date(cursor)
        date.setDate(cursor.getDate() + index)
        const dow = (date.getDay() + 6) % 7
        const thursday = new Date(date)
        thursday.setDate(date.getDate() - dow + 3)
        const jan1 = new Date(thursday.getFullYear(), 0, 1)
        const dayOfYear = Math.round((thursday.getTime() - jan1.getTime()) / 86_400_000) + 1
        weeks.push(Math.floor((dayOfYear - 1) / 7) + 1)
      }
      return [...new Set(weeks)]
    })
    const rendered = weekLabels.map((label) => Number(label.slice(1)))
    for (const week of rendered) {
      assert.ok(
        isoWeeks.includes(week),
        `rendered W${week} is not an ISO week number reachable in this window`,
      )
    }
    // Contiguity: consecutive cells must differ by exactly one ISO week.
    for (let index = 1; index < rendered.length; index += 1) {
      const previous = rendered[index - 1]
      const current = rendered[index]
      const delta = current - previous
      assert.ok(
        delta === 1 || (previous >= 52 && current === 1),
        `week sequence jumps from W${previous} to W${current}`,
      )
    }
  } finally {
    await page.close()
  }
})

await check(
  'Undated items stay visible: header count, drawer and bar count agree',
  '2 unscheduled items listed, 4 bars drawn',
  async () => {
    const { page } = await openView('gantt-view')
    try {
      const { bars, bodyText } = await measureGantt(page)
      assert.match(bodyText, /2 unscheduled items/, 'header does not report the unscheduled count')
      assert.match(bodyText, /4 scheduled items/, 'header does not report the scheduled count')
      // The drawer must actually list them.
      await clickByText(page, '2 unscheduled items')
      await page.waitForTimeout(600)
      const listed = await page.evaluate(() =>
        [...document.querySelectorAll('[data-radix-popper-content-wrapper] button')]
          .map((node) => node.textContent?.trim() ?? '')
          .filter(Boolean),
      )
      const joined = listed.join(' | ')
      assert.match(joined, /Handover notes/, `drawer did not list "Handover notes": ${joined}`)
      assert.match(joined, /Vendor review/, `drawer did not list "Vendor review": ${joined}`)
      // Bars drawn must match the scheduled count — the old header could claim
      // "2 scheduled items" while the chart drew 3 bars.
      assert.equal(bars.length, 4, `expected 4 bars for 4 scheduled items, saw ${bars.length}`)
    } finally {
      await page.close()
    }
  },
)

// ------------------------------------------------------------- time axis ---
await check(
  'Week/day time axis: 24-hour labels, ~10 hours visible, opens at 08:00',
  'labels HH:00, 72px/hour, viewport starts at 08:00',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      await selectRadio(page, 'Week')
      await page.waitForTimeout(2200)
      const axis = await page.evaluate(() => {
        const calendar = document.querySelector('.phaneris-calendar')
        const labels = [...calendar.querySelectorAll('.pg-calendar-hour')].map((node) => node.textContent?.trim() ?? '')
        const scroller = [...calendar.querySelectorAll('*')].find((node) => {
          const style = getComputedStyle(node)
          return (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 4
        })
        if (!scroller) return null
        const pxPerHour = scroller.scrollHeight / 24
        return {
          labels,
          pxPerHour,
          visibleHours: scroller.clientHeight / pxPerHour,
          topHour: scroller.scrollTop / pxPerHour,
        }
      })
      assert.ok(axis, 'the time grid did not produce a scrollable body')
      // 24-hour clock: every label is HH:00, and all 24 hours are rendered so the
      // rest of the day stays reachable by scrolling.
      assert.equal(axis.labels.length, 24, `expected 24 hour labels, saw ${axis.labels.length}`)
      for (const label of axis.labels) {
        assert.match(label, /^\d{2}:00$/, `hour label "${label}" is not 24-hour HH:00`)
      }
      // ~72px per hour puts the working day (08:00-18:00, 10 hours) in the viewport.
      assert.ok(
        Math.abs(axis.pxPerHour - 72) < 1,
        `expected ~72px per hour, measured ${axis.pxPerHour.toFixed(1)}`,
      )
      assert.ok(
        axis.visibleHours >= 8 && axis.visibleHours <= 13,
        `expected 8-13 hours visible, measured ${axis.visibleHours.toFixed(1)}`,
      )
      // Opens on the working day rather than wherever the earliest event happens to be.
      assert.ok(
        Math.abs(axis.topHour - 8) < 0.6,
        `expected the view to open at 08:00, measured ${axis.topHour.toFixed(1)}`,
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'Hour rules are drawn in the time grids and NOT in the month grid',
  'month date cells flat, week body columns lined',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      const read = async (label) => {
        await selectRadio(page, label)
        await page.waitForTimeout(1800)
        return page.evaluate(() => {
          const calendar = document.querySelector('.phaneris-calendar')
          const cells = [...calendar.querySelectorAll('[role="gridcell"][data-date]')]
          const tall = cells.filter((cell) => cell.getBoundingClientRect().height > 200)
          const short = cells.filter((cell) => cell.getBoundingClientRect().height <= 200)
          return {
            view: calendar.getAttribute('data-calendar-view'),
            dateCells: cells.length,
            tallLined: tall.filter((cell) => getComputedStyle(cell).backgroundImage !== 'none').length,
            tallCount: tall.length,
            shortLined: short.filter((cell) => getComputedStyle(cell).backgroundImage !== 'none').length,
          }
        })
      }
      // The month grid's day cells carry `data-date` too (126px tall), so keying the
      // hour rules on that attribute alone also drew three stray lines inside every
      // month cell. Regression guard for exactly that.
      const month = await read('Month')
      assert.equal(month.view, 'month', `expected the month view, wrapper says ${month.view}`)
      assert.ok(month.dateCells > 0, 'no month date cells found')
      assert.equal(month.shortLined, 0, `${month.shortLined} month cells still draw hour rules`)

      const week = await read('Week')
      assert.equal(week.view, 'week', `expected the week view, wrapper says ${week.view}`)
      assert.ok(week.tallCount > 0, 'no time-grid columns found in the week view')
      assert.equal(
        week.tallLined,
        week.tallCount,
        `only ${week.tallLined}/${week.tallCount} time-grid columns carry the hour rules`,
      )
    } finally {
      await page.close()
    }
  },
)

// ------------------------------------------------------- gantt empty state ---
await check(
  'Gantt keeps its frame when nothing is scheduled, with no overlay',
  'task column + scale render, nothing drawn on top',
  async () => {
    const { page, pageErrors } = await openView('gantt-view', { emptyWorkItems: true })
    try {
      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
      const state = await page.evaluate(() => ({
        frame: Boolean(document.querySelector('.phaneris-gantt')),
        scaleCells: document.querySelectorAll('.wx-cell').length,
        rows: document.querySelectorAll('.wx-row').length,
        text: document.body.innerText,
      }))
      // The frame is the point: an empty plan must still look like a planning
      // surface, not a blank page. Nothing is overlaid on it — an earlier revision
      // put an icon/title/CTA card in the middle of the timeline, which is not what
      // this surface should do when it simply has no rows yet.
      assert.ok(state.frame, 'the chart frame was not rendered for an empty plan')
      assert.ok(state.scaleCells > 0, 'the time scale was not rendered for an empty plan')
      assert.ok(state.rows > 0, 'the task-list header row was not rendered for an empty plan')
      assert.doesNotMatch(state.text, /Nothing scheduled yet/, 'an empty-state overlay is still being drawn')
      assert.doesNotMatch(state.text, /Tasks with a start and due date/, 'the old empty-state text is still being drawn')
    } finally {
      await page.close()
    }
  },
)

await check(
  'Gantt header carries the shared controls',
  'project filter + search left, Today centred, segments + New Task right, 42px',
  async () => {
    const { page } = await openView('gantt-view', { width: 2400, height: 1000 })
    try {
      const header = await page.evaluate(() => {
        const input = document.querySelector('input[type="search"]')
        let node = input
        while (node && Math.round(node.getBoundingClientRect().height) !== 42) node = node.parentElement
        if (!node) return null
        const box = node.getBoundingClientRect()
        const today = [...node.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Today')
        const todayBox = today?.getBoundingClientRect()
        return {
          height: Math.round(box.height),
          hasFilter: [...node.querySelectorAll('button')].some((b) => /All Projects/.test(b.textContent ?? '')),
          hasSearch: Boolean(node.querySelector('input[type="search"]')),
          hasNewTask: /New Task/.test(node.innerText),
          offsetFromCentre: todayBox ? Math.round((todayBox.left + todayBox.width / 2) - (box.left + box.width / 2)) : null,
        }
      })
      assert.ok(header, 'the 42px header row was not found')
      // Unified with the board and the list, which were already 42px.
      assert.equal(header.height, 42, `header is ${header.height}px, expected 42`)
      assert.ok(header.hasFilter, 'the project filter is missing')
      assert.ok(header.hasSearch, 'the search box is missing')
      assert.ok(header.hasNewTask, 'the New Task action is missing')
      // Centred via a three-column grid, not `justify-between`.
      assert.ok(
        Math.abs(header.offsetFromCentre) <= 2,
        `Today is ${header.offsetFromCentre}px off centre`,
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'Calendar and Gantt remember their view across a remount',
  'mode/scale persist per workspace',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      await selectRadio(page, 'Week')
      await page.waitForTimeout(1200)
      const stored = await page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => /calendar-view-state|gantt-scale/.test(key))
          .map(([key, value]) => `${key}=${value}`),
      )
      assert.ok(
        stored.some((entry) => entry.includes('calendar-view-state') && entry.includes('week')),
        `the calendar view choice was not persisted: ${JSON.stringify(stored)}`,
      )
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4000)
      const active = await page.evaluate(() =>
        [...document.querySelectorAll('[role="radio"]')]
          .filter((node) => ['Day', 'Week', 'Month'].includes(node.textContent?.trim() ?? ''))
          .find((node) => node.getAttribute('aria-checked') === 'true')?.textContent?.trim(),
      )
      // Opening an entry unmounts the view; returning must not silently reset it.
      assert.equal(active, 'Week', `after a remount the calendar showed ${active}`)
    } finally {
      await page.close()
    }
  },
)

// ----------------------------------------------------------------- calendar ---
await check(
  'Calendar (FullCalendar) renders with our header and no library toolbar',
  'entries > 0, .fc toolbar buttons = 0',
  async () => {
    const { page, pageErrors } = await openView('calendar-view')
    try {
      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
      const observed = await page.evaluate(() => {
        const calendar = document.querySelector('.phaneris-calendar')
        if (!calendar) return null
        const style = getComputedStyle(calendar)
        return {
          entries: document.querySelectorAll('[data-calendar-entry]').length,
          // The library's own toolbar must be gone: the app's header drives the
          // calendar through useCalendarController.
          libraryButtons: calendar.querySelectorAll('[class*="fc-"] button').length,
          // The page holds other playground controls, so scope to the three
          // view segments by their accessible names rather than counting radios.
          segments: [...document.querySelectorAll('[role="radio"]')]
            .map((node) => ({
              label: node.textContent?.trim() ?? '',
              checked: node.getAttribute('aria-checked'),
            }))
            .filter((segment) => ['Day', 'Week', 'Month'].includes(segment.label)),
          groupLabelled: [...document.querySelectorAll('[role="radiogroup"]')]
            .some((node) => (node.getAttribute('aria-label') ?? '').length > 0),
          title: document.querySelector('[data-calendar-title]')?.textContent?.trim() ?? '',
          // Token bridge, so the calendar cannot look like a foreign widget.
          background: style.getPropertyValue('--fc-classic-background').trim(),
          primary: style.getPropertyValue('--fc-classic-primary').trim(),
          border: style.getPropertyValue('--fc-classic-border').trim(),
          grids: calendar.querySelectorAll('[role="grid"]').length,
        }
      })
      assert.ok(observed, 'the calendar did not mount (no .phaneris-calendar)')
      assert.ok(observed.entries > 0, `expected calendar entries, saw ${observed.entries}`)
      assert.equal(observed.libraryButtons, 0, 'the library toolbar was not fully suppressed')
      assert.equal(
        observed.segments.length,
        3,
        `expected three day/week/month radio segments, saw ${JSON.stringify(observed.segments)}`,
      )
      assert.equal(
        observed.segments.filter((segment) => segment.checked === 'true').length,
        1,
        'exactly one segment must be checked (role=radio + aria-checked)',
      )
      assert.ok(observed.groupLabelled, 'the segmented control has no group label (role=radiogroup + aria-label)')
      assert.match(observed.title, /\d{4}/, `header title looks wrong: "${observed.title}"`)
      assert.ok(observed.grids >= 1, 'no ARIA grid rendered')
      for (const [name, value] of Object.entries({
        background: observed.background,
        primary: observed.primary,
        border: observed.border,
      })) {
        assert.ok(value && value !== '', `token --fc-classic-${name} was not bridged: "${value}"`)
      }
    } finally {
      await page.close()
    }
  },
)

// -------------------------------------------------------- create from a slot ---
/**
 * Clicking and dragging empty grid space.
 *
 * The gesture used to be `dateClick`, which reports a single instant and nothing
 * else, so the only thing a drag could create was a one-hour default. `select`
 * reports the whole selected span, and the observable is the route the calendar
 * navigates to: `calendar/schedule/new:<date>@<start>-<end>`.
 *
 * These run against the live-navigation preview, so the second half of the claim —
 * that the editor opens on the range the gesture drew — is asserted too, not just
 * the string it produced.
 */
const LIVE_SURFACE = { query: '?ws=schedule&route=calendar' }

const routeDraft = (page) => {
  const route = new URL(page.url()).searchParams.get('route') ?? ''
  const marker = 'calendar/schedule/'
  return route.startsWith(marker) ? decodeURIComponent(route.slice(marker.length)) : null
}

/** Aims at the top edge of a slot lane, in the sixth day column. */
const slotPoint = (page, time, offsetY = 2) => page.evaluate(({ wanted, dy }) => {
  const lane = [...document.querySelectorAll('[data-time]')]
    .find((node) => node.getBoundingClientRect().width > 200 && node.getAttribute('data-time')?.startsWith(wanted))
  const column = [...document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]")]
    .filter((node) => node.getBoundingClientRect().height > 100)[5]
  if (!lane || !column) return null
  const laneRect = lane.getBoundingClientRect()
  const columnRect = column.getBoundingClientRect()
  return { x: columnRect.x + columnRect.width / 2, y: laneRect.y + dy, date: column.getAttribute('data-date') }
}, { wanted: time, dy: offsetY })

await check(
  'A single click on an empty slot opens the editor on exactly that one slot',
  'click 13:00 -> the shared editor is seeded 13:00-13:30, not a default hour',
  async () => {
    const { page, pageErrors } = await openView('projects-surface-live', LIVE_SURFACE)
    try {
      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
      assert.ok(await page.locator('.phaneris-calendar').count() > 0, 'the live surface did not open the calendar')
      await selectRadio(page, 'Week')
      await page.waitForTimeout(1200)
      const point = await slotPoint(page, '13:00')
      assert.ok(point, 'could not locate a 13:00 slot')

      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(1500)
      assert.equal(await editorIsOpen(page), 1, 'a click on empty space did not open the editor')
      const seeded = await page.evaluate(() =>
        [...document.querySelectorAll('[data-task-editor-overlay] input[type="time"]')].map((node) => node.value))
      assert.deepEqual(
        seeded, ['13:00', '13:30'],
        `a click must seed the slot it landed on, the editor got ${JSON.stringify(seeded)}`,
      )
    } finally {
      await page.close()
    }
  },
)

// ------------------------------------------------- playground registration ---
/**
 * Every Project Management projection must have a working Playground preview.
 *
 * This is the check that was missing when the Gantt entry was reverted out of the
 * registry without anyone noticing: the projection kept shipping, the sidebar just
 * showed one fewer card, and the surface nobody could look at was also the one the
 * E2E suite drives. Selecting each id and requiring a populated preview proves the
 * entry exists AND mounts — a name match in the sidebar would prove neither.
 */
const PROJECTION_PREVIEWS = [
  ['overview', 'projects-overview-view'],
  ['list', 'work-item-list-view'],
  ['board', 'work-item-board-view'],
  ['calendar', 'calendar-view'],
  ['gantt', 'gantt-view'],
]

await check(
  'The Playground registers a working preview for every Project Management view',
  'overview / list / board / calendar / gantt all mount something',
  async () => {
    const missing = []
    for (const [view, id] of PROJECTION_PREVIEWS) {
      const { page, pageErrors } = await openView(id)
      try {
        const mounted = await page.evaluate(() => {
          const text = document.body.innerText
          if (text.includes('Select a component from the sidebar')) return false
          return document.querySelectorAll('.phaneris-calendar, .phaneris-gantt, [data-task-editor-overlay]').length > 0
            || document.querySelectorAll('button, [role="gridcell"], [role="row"]').length > 10
        })
        if (!mounted || pageErrors.length > 0) missing.push(`${view} (${id})${pageErrors.length ? `: ${pageErrors[0]}` : ''}`)
      } finally {
        await page.close()
      }
    }
    assert.deepEqual(missing, [], `projection previews that did not mount: ${missing.join(', ')}`)
  },
)

await check(
  'The live-navigation surface the create/edit checks drive is registered',
  'projects-surface-live opens the Projects surface from a real route',
  async () => {
    const { page, pageErrors } = await openView('projects-surface-live', LIVE_SURFACE)
    try {
      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
      assert.ok(
        await page.locator('.phaneris-calendar').count() > 0,
        '?route=calendar did not render the calendar through the live surface',
      )
    } finally {
      await page.close()
    }
  },
)

// ------------------------------------------------------------- untimed rail ---
/**
 * The rail replaced the library's all-day row.
 *
 * Measured before this change: 26 of the 28 distinct planning values in a real
 * workspace are date-only, so the single horizontal all-day band carried almost
 * every entry while the 24-hour grid beneath it stayed empty. Moving them into a
 * rail gives the grid its height back — but only if nothing is lost doing it, so
 * these checks pin both halves: the entries are all still reachable, and the two
 * gestures that move them between the rail and the grid write what they claim.
 */
const showCalendarView = async (page, label) => {
  await selectRadio(page, label)
  await page.waitForTimeout(1200)
}

const calendarGeometry = (page) => page.evaluate(() => {
  const header = document.querySelector(".phaneris-calendar [role='columnheader']")
  const rail = document.querySelector('.pg-rail')
  const railRect = rail?.getBoundingClientRect()
  return {
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
    headerLines: header
      ? [...header.querySelectorAll('.pg-cal-head__weekday, .pg-cal-head__date')].map((node) => node.textContent)
      : [],
    todayHeaders: document.querySelectorAll('.pg-cal-head--today').length,
    railWidth: railRect ? Math.round(railRect.width) : null,
    railGroups: [...document.querySelectorAll('.pg-rail__group')].map((node) => node.getAttribute('data-rail-date')),
    railEntries: [...document.querySelectorAll('[data-rail-entry]')].map((node) => node.getAttribute('data-rail-entry')),
    railCount: document.querySelector('[data-rail-count]')?.textContent ?? '',
    allDayLabels: [...document.querySelectorAll('.phaneris-calendar *')]
      .filter((node) => node.children.length === 0 && node.textContent?.trim() === 'All-day').length,
    gridEntries: [...document.querySelectorAll('[data-calendar-entry]')].map((node) => node.getAttribute('data-calendar-entry')),
    visibleDates: [...document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]")]
      .filter((node) => node.getBoundingClientRect().height > 100)
      .map((node) => node.getAttribute('data-date')),
  }
})

await check(
  'Day and week headers carry two lines, the month header one, all the same height',
  '52px in 日/周/月; 日/周 show weekday+date and mark today, 月 shows the weekday only',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      const heights = {}
      for (const [mode, label] of [['day', 'Day'], ['week', 'Week'], ['month', 'Month']]) {
        await showCalendarView(page, label)
        const geometry = await calendarGeometry(page)
        heights[mode] = geometry.headerHeight
        if (mode === 'month') {
          assert.deepEqual(
            geometry.headerLines.filter(Boolean).length, 1,
            `the month header must carry a single line, saw ${JSON.stringify(geometry.headerLines)}`,
          )
          assert.equal(geometry.todayHeaders, 0, 'the month header has no single "today" column to mark')
        } else {
          assert.equal(
            geometry.headerLines.length, 2,
            `the ${mode} header must carry weekday + date, saw ${JSON.stringify(geometry.headerLines)}`,
          )
          assert.ok(
            /^\d+\/\d+$/.test(geometry.headerLines[1] ?? ''),
            `the second header line must be a date, saw ${geometry.headerLines[1]}`,
          )
          assert.equal(geometry.todayHeaders, 1, `the ${mode} header must mark exactly one today`)
        }
      }
      assert.equal(
        new Set(Object.values(heights)).size, 1,
        `the three views must share one header height, measured ${JSON.stringify(heights)}`,
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'The all-day row is gone from 日/周 and the rail holds every untimed entry instead',
  'no all-day lane; rail is 300px; month keeps its chips and has no rail',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      await showCalendarView(page, 'Week')
      const week = await calendarGeometry(page)
      assert.equal(week.allDayLabels, 0, 'the all-day row is still rendered in the week view')
      assert.equal(week.railWidth, 300, `the rail should be 300px wide, measured ${week.railWidth}`)
      assert.ok(week.railEntries.length > 0, 'the rail is empty although the fixtures carry untimed entries')
      assert.ok(week.railGroups.length > 0, 'the rail has no day groups')

      // The rail is the backlog, not the visible week: it must list other weeks.
      const outside = week.railGroups.filter((date) => !week.visibleDates.includes(date))
      assert.ok(
        outside.length > 0,
        `the rail only listed the visible week (${week.railGroups.join(', ')} vs ${week.visibleDates.join(', ')})`,
      )

      await showCalendarView(page, 'Day')
      const day = await calendarGeometry(page)
      assert.equal(day.allDayLabels, 0, 'the all-day row is still rendered in the day view')
      assert.ok(day.railEntries.length > 0, 'the day view lost the rail')

      await showCalendarView(page, 'Month')
      const month = await calendarGeometry(page)
      assert.equal(month.railWidth, null, 'the month view must not render the rail')
      assert.ok(
        month.gridEntries.length > 0,
        'the month view lost the untimed entries when the all-day row was removed',
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'Dragging a rail entry to the grid edge scrolls the grid while the pointer holds still',
  'scrollTop advances to the end of the range with the preview still following',
  async () => {
    const { page } = await openView('projects-surface-live', LIVE_SURFACE)
    try {
      await selectRadio(page, 'Week')
      await page.waitForTimeout(1200)
      const scroller = () => page.evaluate(() => {
        const root = document.querySelector('.phaneris-calendar')
        let node = root?.querySelector('[data-time]')?.parentElement ?? null
        while (node && node !== root) {
          const style = getComputedStyle(node)
          if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
            const rect = node.getBoundingClientRect()
            return { top: rect.top, bottom: rect.bottom, scrollTop: node.scrollTop, max: node.scrollHeight - node.clientHeight }
          }
          node = node.parentElement
        }
        return null
      })
      const before = await scroller()
      assert.ok(before && before.max > 200, `no scrollable time body: ${JSON.stringify(before)}`)
      const chip = await page.locator('.pg-rail__chip').first().boundingBox()
      const dropX = await page.evaluate(() => {
        const column = [...document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]")]
          .filter((node) => node.getBoundingClientRect().height > 100)[2]
        const rect = column.getBoundingClientRect()
        return rect.x + rect.width / 2
      })

      await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2)
      await page.mouse.down()
      const targetY = before.bottom - 12
      for (let step = 1; step <= 10; step += 1) {
        await page.mouse.move(dropX, chip.y + ((targetY - chip.y) * step) / 10)
        await page.waitForTimeout(18)
      }
      // Hold still: the scroll has to be driven by time, not by pointer movement.
      const samples = []
      for (let i = 0; i < 6; i += 1) {
        await page.waitForTimeout(180)
        samples.push((await scroller()).scrollTop)
      }
      const previewWhileScrolling = await page.evaluate(() => Boolean(document.querySelector('[data-calendar-droptarget]')))
      await page.mouse.up()
      await page.waitForTimeout(600)
      const after = await scroller()

      assert.ok(
        after.scrollTop > before.scrollTop + 100,
        `holding at the edge did not scroll: ${before.scrollTop} -> ${after.scrollTop} (samples ${samples.join(',')})`,
      )
      assert.ok(
        after.scrollTop <= after.max + 1,
        `the scroll ran past the end of the range: ${after.scrollTop} > ${after.max}`,
      )
      assert.ok(previewWhileScrolling, 'the drop preview disappeared while auto-scrolling')
    } finally {
      await page.close()
    }
  },
)

await check(
  'A narrow panel collapses the rail into a header chip that opens the same list',
  'wide panel -> rail; narrow panel -> chip, and the chip still lists every untimed entry',
  async () => {
    const probeAt = async (previewWidth) => {
      /*
       * A tall viewport on purpose: the preview frame is 860px tall, and in a shorter
       * window the Playground's own component description overlaps its top edge — which
       * is exactly where the header chip lives, so the click would be intercepted by
       * the harness rather than by the product.
       */
      const { page } = await openView('projects-surface-live', { ...LIVE_SURFACE, previewWidth, height: 1100 })
      try {
        await selectRadio(page, 'Week')
        await page.waitForTimeout(1200)
        const state = await page.evaluate(() => {
          const visible = (node) => Boolean(node && node.getBoundingClientRect().width > 0)
          return {
            rail: visible(document.querySelector('.pg-rail')),
            chip: visible(document.querySelector('[data-calendar-untimed-trigger]')),
          }
        })
        if (state.chip) {
          await page.locator('[data-calendar-untimed-trigger]').click()
          await page.waitForTimeout(600)
          state.popoverEntries = await page.evaluate(() =>
            document.querySelectorAll('[data-rail-entry]').length)
        }
        return state
      } finally {
        await page.close()
      }
    }

    const wide = await probeAt(1440)
    assert.ok(wide.rail && !wide.chip, `a wide panel must show the rail: ${JSON.stringify(wide)}`)
    const narrow = await probeAt(820)
    assert.ok(!narrow.rail && narrow.chip, `a narrow panel must collapse the rail: ${JSON.stringify(narrow)}`)
    // Nothing may be lost when it collapses: the chip carries the whole list.
    assert.ok(
      (narrow.popoverEntries ?? 0) > 0,
      'the collapsed chip opened an empty list, so the entries became unreachable',
    )
  },
)

await check(
  'Dropping a rail entry on the grid writes that date and time',
  'rail -> grid: {date, time, allDay:false}, and the entry leaves the rail',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      await showCalendarView(page, 'Week')
      const before = await calendarGeometry(page)
      const chip = await page.locator('.pg-rail__chip').first().boundingBox()
      const entryId = await page.locator('[data-rail-entry]').first().getAttribute('data-rail-entry')
      const drop = await page.evaluate(() => {
        const lane = [...document.querySelectorAll('[data-time]')]
          .find((node) => node.getBoundingClientRect().width > 200 && node.getAttribute('data-time')?.startsWith('15:00'))
        const column = [...document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]")]
          .filter((node) => node.getBoundingClientRect().height > 100)[5]
        if (!lane || !column) return null
        const laneRect = lane.getBoundingClientRect()
        const columnRect = column.getBoundingClientRect()
        return { x: columnRect.x + columnRect.width / 2, y: laneRect.y + laneRect.height / 2, date: column.getAttribute('data-date') }
      })
      assert.ok(drop, 'could not locate a 15:00 slot to drop on')

      const writes = []
      const onConsole = (message) => {
        if (message.text().includes('updateCalendarEntry called')) writes.push(message.text())
      }
      page.on('console', onConsole)
      await dragBetween(page, { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, drop)
      page.off('console', onConsole)

      assert.ok(writes.length > 0, 'the drop wrote nothing')
      const payload = writes.at(-1)
      assert.ok(payload.includes(entryId), `the write was for another entry: ${payload}`)
      assert.ok(payload.includes(`date: ${drop.date}`), `the dropped date was not written: ${payload}`)
      assert.ok(payload.includes('time: 15:00'), `the dropped time was not written: ${payload}`)
      assert.ok(payload.includes('allDay: false'), `the entry stayed all-day: ${payload}`)

      const after = await calendarGeometry(page)
      assert.equal(
        after.railEntries.length, before.railEntries.length - 1,
        'the scheduled entry is still listed in the rail',
      )
      assert.ok(after.gridEntries.includes(entryId), 'the scheduled entry did not appear in the grid')
    } finally {
      await page.close()
    }
  },
)

await check(
  'Dropping a timed entry on the rail clears its time and keeps its date',
  'grid -> rail: {date unchanged, allDay:true}, and the entry returns to the rail',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      await showCalendarView(page, 'Week')
      const before = await calendarGeometry(page)
      const chip = await page.locator('[data-calendar-entry]').first().boundingBox()
      const entryId = before.gridEntries[0]
      const railBox = await page.locator('.pg-rail').boundingBox()

      const writes = []
      const onConsole = (message) => {
        if (message.text().includes('updateCalendarEntry called')) writes.push(message.text())
      }
      page.on('console', onConsole)
      await dragBetween(page, { x: chip.x + 20, y: chip.y + 6 }, { x: railBox.x + railBox.width / 2, y: railBox.y + 320 })
      page.off('console', onConsole)

      assert.ok(writes.length > 0, 'dropping on the rail wrote nothing')
      const payload = writes.at(-1)
      assert.ok(payload.includes(entryId), `the write was for another entry: ${payload}`)
      assert.ok(payload.includes('allDay: true'), `the time was not cleared: ${payload}`)
      assert.ok(!payload.includes('time:'), `a time survived the drop: ${payload}`)

      const after = await calendarGeometry(page)
      assert.ok(after.railEntries.includes(entryId), 'the entry did not return to the rail')
      assert.ok(!after.gridEntries.includes(entryId), 'the entry is still drawn in the grid')
      assert.equal(
        after.railEntries.length, before.railEntries.length + 1,
        'the rail count did not grow by exactly one',
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  "The rail's + creates an entry from a title and a date alone",
  'create: {title, date, allDay:true} with no time invented',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      await showCalendarView(page, 'Week')
      const before = await calendarGeometry(page)
      const writes = []
      const onConsole = (message) => {
        if (message.text().includes('createCalendarEntry called')) writes.push(message.text())
      }
      page.on('console', onConsole)
      await page.locator('.pg-rail__add').click()
      await page.locator('.pg-rail__input').first().fill('Rail quick add')
      await page.locator('.pg-rail__button--primary').click()
      await page.waitForTimeout(800)
      page.off('console', onConsole)

      assert.ok(writes.length > 0, 'the quick add wrote nothing')
      const payload = writes.at(-1)
      assert.ok(payload.includes('Rail quick add'), `the title was not written: ${payload}`)
      assert.ok(payload.includes('allDay: true'), `the entry was not created as date-only: ${payload}`)
      assert.ok(!payload.includes('time:'), `the quick add invented a time: ${payload}`)
      const after = await calendarGeometry(page)
      assert.equal(
        after.railEntries.length, before.railEntries.length + 1,
        'the new entry did not land in the rail',
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'Month overflow is reachable: a 5-entry day exposes the rest through "+N more"',
  'overflow control opens and lists every hidden entry',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      // The fixture puts five entries on one day. The old month cell rendered a
      // hardcoded three, crushed them to 6px, and left an unfocusable <span>.
      const before = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('[data-calendar-entry]')]
          .map((node) => node.textContent?.trim() ?? '')
        const overflow = [...document.querySelectorAll('*')]
          .filter((node) => node.children.length === 0 && /^\+\d+\s/.test(node.textContent?.trim() ?? ''))
          .map((node) => ({ text: node.textContent.trim(), tag: node.tagName, clickable: node.closest('a,button,[role="button"]') !== null }))
        return { visible, overflow }
      })
      assert.ok(before.overflow.length > 0, 'no "+N more" overflow control rendered for the 5-entry day')
      const control = before.overflow[0]
      assert.ok(
        control.clickable,
        `the overflow control is not clickable (tag=${control.tag}) — the old view rendered a bare <span>`,
      )
      // Clicking it must reveal the hidden entries.
      await page.evaluate(() => {
        const node = [...document.querySelectorAll('*')]
          .find((el) => el.children.length === 0 && /^\+\d+\s/.test(el.textContent?.trim() ?? ''))
        const target = node?.closest('a,button,[role="button"]') ?? node
        target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await page.waitForTimeout(900)
      const revealed = await page.evaluate(() => document.body.innerText)
      for (const title of ['Busy 1', 'Busy 2', 'Busy 3', 'Busy 4', 'Busy 5']) {
        assert.match(revealed, new RegExp(title), `"${title}" was not reachable after opening the overflow`)
      }
    } finally {
      await page.close()
    }
  },
)

await check(
  'Out-of-window timed entries render inside the time grid (07:00 and 22:00)',
  'both entries present and contained by [role=grid]',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      await selectRadio(page, 'Day')
      await page.waitForTimeout(1500)

      /** Steps forward day by day until the wanted entry is on screen. */
      const findEntry = async (id) => {
        for (let step = 0; step < 8; step += 1) {
          const found = await page.evaluate(async (wanted) => {
            const node = document.querySelector(`[data-calendar-entry="${wanted}"]`)
            if (!node) return null
            const calendar = document.querySelector('.phaneris-calendar')
            const grids = [...calendar.querySelectorAll('[role="grid"]')]
            const grid = grids[grids.length - 1]
            if (!grid) return null
            // A day is taller than the panel, so an evening entry starts below the
            // fold. Scroll to it the way a user would, then measure: the claim is
            // that it lives inside the grid, not that it is visible without
            // scrolling.
            node.scrollIntoView({ block: 'center' })
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            const entryBox = node.getBoundingClientRect()
            const gridBox = grid.getBoundingClientRect()
            return {
              text: node.textContent?.trim() ?? '',
              top: entryBox.top,
              bottom: entryBox.bottom,
              gridTop: gridBox.top,
              gridBottom: gridBox.bottom,
              // The old view painted 07:00 above the grid and 22:00 below it —
              // outside the grid entirely, not merely scrolled out of view.
              withinGrid: entryBox.top >= gridBox.top - 2 && entryBox.bottom <= gridBox.bottom + 2,
            }
          }, id)
          if (found) return found
          await page.evaluate(() => {
            const next = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '›')
            next?.click()
          })
          await page.waitForTimeout(1000)
        }
        return null
      }

      // n5 = 07:00 (before the old hardcoded 08:00 window), n6 = 22:00 (after 20:00).
      for (const [id, label] of [['n5', '07:00 entry'], ['n6', '22:00 entry']]) {
        const found = await findEntry(id)
        assert.ok(found, `${label} (${id}) never rendered in the day view`)
        assert.ok(
          found.withinGrid,
          `${label} is painted outside the time grid (entry ${found.top.toFixed(0)}–${found.bottom.toFixed(0)} vs grid ${found.gridTop.toFixed(0)}–${found.gridBottom.toFixed(0)})`,
        )
      }
    } finally {
      await page.close()
    }
  },
)

await check(
  'Calendar entries are keyboard-reachable (the old chips were unfocusable divs)',
  'every entry has tabindex >= 0 and a pointer cursor',
  async () => {
    const { page } = await openView('calendar-view')
    try {
      const entries = await page.evaluate(() =>
        [...document.querySelectorAll('[data-calendar-entry]')].map((node) => ({
          id: node.getAttribute('data-calendar-entry'),
          tabindex: node.getAttribute('tabindex'),
          cursor: getComputedStyle(node).cursor,
        })),
      )
      assert.ok(entries.length > 0, 'no calendar entries rendered')
      for (const entry of entries) {
        // The old month view rendered entries as plain <div>s with no role and no
        // tabIndex, so overflowing entries had no keyboard path at all.
        assert.ok(
          entry.tabindex !== null && Number(entry.tabindex) >= 0,
          `entry ${entry.id} is not focusable (tabindex=${entry.tabindex})`,
        )
        assert.equal(entry.cursor, 'pointer', `entry ${entry.id} does not advertise interactivity`)
      }
    } finally {
      await page.close()
    }
  },
)

/*
 * Drag-to-reschedule is deliberately NOT asserted here. Its risky part is the
 * inclusive/exclusive date conversion on the write path, which is covered
 * deterministically by `apps/electron/src/renderer/lib/__tests__/calendar-events.test.ts`
 * (17 cases, mutation-verified: dropping the `+1 day` on read, the `-1 day` on
 * write, or advancing a timed end each fail the suite). Driving the library's
 * pointer drag in headless Chromium does not start its interaction handler, so
 * an E2E assertion here would test the harness rather than the product.
 */

// ------------------------------------------- create and edit, unified editor ---
/**
 * One editor for project work.
 *
 * The board's simplified form and the calendar's schedule page are gone; the shared
 * Task Definition editor is the only surface that creates or edits a row, and the
 * two pages' fields (status, progress, milestone, parent, dependencies, plan dates)
 * moved into it. The plan dates are the load-bearing half: the calendar's create
 * gesture draws a slot or a range, and that has to arrive as `planning` on the
 * create request or the gesture is decorative.
 *
 * The range guard that used to live in the schedule page (and only there, plus
 * `calendar:update`) moved to `updateSessionPlanning` — the one choke point every
 * writer shares — and is covered by `planRangeError` unit cases; a browser test
 * cannot reach the real server from the Playground's mocked IPC.
 */
/** Fills the minimum this editor needs before it will submit at all. */
async function fillMinimalTask(page, title) {
  await page.locator('[data-task-editor-overlay] input').first().fill(title)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-task-editor-overlay] button')]
      .find((node) => node.textContent?.includes('Add subtask'))
    button?.click()
  })
  await page.waitForTimeout(400)
  await page.locator('[data-task-editor-overlay] input[placeholder^="Subtask title"]').first().fill('First step')
  await page.locator('[data-task-editor-overlay] textarea').last().fill('Do the first step.')
  await page.waitForTimeout(200)
}

await check(
  'A range drawn on the calendar opens the shared editor already planned',
  'drag 5 slots from 09:00 -> editor seeded 09:00-11:30 -> createRequest.planning matches',
  async () => {
    const { page, pageErrors } = await openView('projects-surface-live', LIVE_SURFACE)
    try {
      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`)
      await selectRadio(page, 'Week')
      await page.waitForTimeout(1200)
      const point = await slotPoint(page, '09:00')
      const laneHeight = await page.evaluate(() => {
        const lane = [...document.querySelectorAll('[data-time]')]
          .find((node) => node.getBoundingClientRect().width > 200 && node.getAttribute('data-time')?.startsWith('09:00'))
        return lane ? lane.getBoundingClientRect().height : 0
      })
      assert.ok(point && laneHeight > 10, 'could not locate the 09:00 slot')

      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      for (let step = 1; step <= 12; step += 1) {
        await page.mouse.move(point.x, point.y + (laneHeight * 4.5 * step) / 12)
        await page.waitForTimeout(20)
      }
      await page.mouse.up()
      await page.waitForTimeout(1500)

      assert.equal(await editorIsOpen(page), 1, 'the create gesture did not open the shared editor')
      const seeded = await page.evaluate(() =>
        [...document.querySelectorAll('[data-task-editor-overlay] input[type="time"]')].map((node) => node.value))
      assert.deepEqual(
        seeded, ['09:00', '11:30'],
        `the editor must open on the drawn range, it opened on ${JSON.stringify(seeded)}`,
      )

      const writes = []
      const onConsole = (message) => {
        if (message.text().includes('createTask called')) writes.push(message.text())
      }
      page.on('console', onConsole)
      await fillMinimalTask(page, 'Planned from the calendar')
      await clickByText(page, 'Create')
      await page.waitForTimeout(1500)
      page.off('console', onConsole)

      assert.ok(writes.length > 0, 'submitting the editor wrote nothing')
      const payload = writes.at(-1)
      assert.match(
        payload, /"planning":\{"startAt":"[^"]*T09:00","dueAt":"[^"]*T11:30"/,
        `the drawn range did not reach the create request: ${payload}`,
      )
      assert.ok(
        payload.includes(`"startAt":"${point.date}T09:00"`),
        `the plan landed on another day: ${payload}`,
      )
    } finally {
      await page.close()
    }
  },
)

await check(
  'A rejected create keeps the shared editor open and says why',
  'error toast shown, editor still mounted',
  async () => {
    const { page } = await openView('projects-surface-live', LIVE_SURFACE)
    try {
      await selectRadio(page, 'Week')
      await page.waitForTimeout(1200)
      const point = await slotPoint(page, '14:00')
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(1200)
      assert.equal(await editorIsOpen(page), 1, 'clicking a slot did not open the editor')

      // Fail the write the way the server would.
      await page.evaluate(() => {
        window.electronAPI.createTask = async () => {
          throw new Error('Session start must not be after its end')
        }
      })
      await fillMinimalTask(page, 'Will be rejected')
      await clickByText(page, 'Create')
      await page.waitForTimeout(1800)
      const outcome = await page.evaluate(() => ({ text: document.body.innerText }))
      assert.match(outcome.text, /Failed to create the task/, 'no failure feedback was shown')
      assert.match(outcome.text, /must not be after its end/, 'the server reason was not surfaced')
      assert.equal(await editorIsOpen(page), 1, 'the editor closed despite the write failing')
    } finally {
      await page.close()
    }
  },
)

await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`)
const failed = results.checks.filter((entry) => entry.status === 'fail')
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed — wrote ${outputPath}`)
await browser.close()
process.exit(failed.length ? 1 : 0)

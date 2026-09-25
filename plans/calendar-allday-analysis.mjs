/**
 * Diagnostic: what happens to each calendar entry when the all-day row is hidden,
 * and what does a drag across slots select?
 *
 * Prints, per view, every rendered `[data-calendar-entry]` with its id, geometry
 * and the entry's own shape, so the effect of `allDaySlot={false}` is attributable
 * to specific fixtures rather than to a total count.
 *
 * Usage: node plans/calendar-allday-analysis.mjs [base] [label]
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5199'
const label = process.argv[3] ?? 'current'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.addInitScript(() => {
  localStorage.setItem('playground-selected-component', 'calendar-view')
  localStorage.setItem('playground-preview-size', JSON.stringify({ width: 1400, height: 860 }))
  localStorage.setItem('playground-variants-sidebar-open', 'false')
  localStorage.setItem('i18nextLng', 'en')
})
await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
await page.waitForTimeout(3500)

const selectRadio = (name) => page.evaluate((wanted) => {
  const target = [...document.querySelectorAll('[role="radio"]')].find((n) => n.textContent?.trim() === wanted)
  if (!target) throw new Error(`no radio "${wanted}"`)
  target.click()
  return true
}, name)

const probe = () => page.evaluate(() => {
  const round = (n) => Math.round(n * 100) / 100
  const calendar = document.querySelector('.phaneris-calendar')
  const grid = calendar?.querySelector("[role='grid']")
  const gridTop = grid ? grid.getBoundingClientRect().top : 0
  const entries = [...document.querySelectorAll('[data-calendar-entry]')].map((el) => {
    const r = el.getBoundingClientRect()
    return {
      id: el.getAttribute('data-calendar-entry'),
      text: el.textContent?.trim() ?? '',
      x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height),
      laneOffset: round(r.y - gridTop),
    }
  })
  // The all-day lane, if any, is the block of rows above the scrolling time body.
  const rows = [...document.querySelectorAll("[role='row']")].length
  return { view: calendar?.getAttribute('data-calendar-view'), rows, gridTop: round(gridTop), count: entries.length, entries }
})

const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) / steps) * i, from.y + ((to.y - from.y) / steps) * i)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
}

const report = { label, views: {} }
for (const mode of ['Day', 'Week', 'Month']) {
  await selectRadio(mode)
  await page.waitForTimeout(900)
  report.views[mode] = await probe()
}

// Back to Week and try a drag across the time grid: what does the app do?
await selectRadio('Week')
await page.waitForTimeout(900)
const weekGrid = await page.evaluate(() => {
  const cells = [...document.querySelectorAll(".phaneris-calendar [role='gridcell']")]
    .filter((c) => c.getBoundingClientRect().height > 100)
  const pick = cells[2] ?? cells[0]
  if (!pick) return null
  const r = pick.getBoundingClientRect()
  return { x: r.x + r.width / 2, top: r.y + 8 }
})
if (weekGrid) {
  const urlBefore = page.url()
  // A plain click on a 10:00 slot: the documented "create at this time" path.
  await page.mouse.click(weekGrid.x, weekGrid.top + 144)
  await page.waitForTimeout(900)
  const afterClick = page.url()
  const clickHeadline = await page.evaluate(() => {
    const title = document.querySelector("[data-calendar-title]")?.textContent?.trim()
    const editor = document.body.innerText.includes('New Schedule') || document.body.innerText.includes('All day')
    return { title, editorVisible: editor }
  })
  // And a drag down two 30-minute slots, inside one day column.
  await drag({ x: weekGrid.x, y: weekGrid.top + 120 }, { x: weekGrid.x, y: weekGrid.top + 120 + 72 })
  await page.waitForTimeout(900)
  report.drag = {
    urlBefore,
    urlAfterClick: afterClick,
    urlAfterDrag: page.url(),
    clickHeadline,
    selectionNodes: await page.evaluate(() => document.querySelectorAll('.fc-highlight, [class*="highlight"]').length),
  }
}

console.log(JSON.stringify(report, null, 2))
await browser.close()

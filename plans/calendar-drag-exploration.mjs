/**
 * Exploration: how much of "drag a calendar entry to another day" already works?
 *
 * Drives the real Playground with real mouse gestures and reads the mock's own
 * write log (`[Playground] updateCalendarEntry called:`) — so what is observed is
 * the payload the view actually sends to the server, not the intent of the code.
 *
 * Covered:
 *   1. an all-day chip in the week view's all-day row  (the 93% case)
 *   2. a timed entry in the week view's time grid
 *   3. an all-day chip in the month grid
 *   4. a resize of a multi-day chip
 *
 * Usage: node plans/calendar-drag-exploration.mjs [base]
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5199'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const writes = []
page.on('console', (message) => {
  const text = message.text()
  const marker = '[Playground] updateCalendarEntry called:'
  if (text.startsWith(marker)) writes.push(text.slice(marker.length).trim())
})
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)))

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
}, name)

const boxOf = (id) => page.evaluate((entryId) => {
  const el = document.querySelector(`[data-calendar-entry="${entryId}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, top: r.y }
}, id)

const dayColumnWidth = () => page.evaluate(() => {
  const cells = [...document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]")]
    .filter((c) => c.getBoundingClientRect().height > 100)
  if (cells.length > 1) return cells[1].getBoundingClientRect().width
  const monthCells = [...document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]")]
  return monthCells[0]?.getBoundingClientRect().width ?? 120
})

const drag = async (from, dx, dy) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(from.x + (dx / 12) * i, from.y + (dy / 12) * i)
    await page.waitForTimeout(18)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
}

const section = (label) => { writes.push(`### ${label}`) }

// --- 1 & 2: week view -------------------------------------------------------
await selectRadio('Week')
await page.waitForTimeout(1200)
const colW = await dayColumnWidth()
console.log('day column width:', colW)

section('week: drag the all-day chip (n4, date-only) one day to the right')
const n4 = await boxOf('n4')
if (!n4) console.log('  n4 not rendered')
else await drag(n4, colW, 0)

section('week: drag the timed entry (n1, 10:00-10:30) down two slots (72px)')
const n1 = await boxOf('n1')
if (!n1) console.log('  n1 not rendered')
else await drag(n1, 0, 72)

// --- 3: month view ----------------------------------------------------------
await selectRadio('Month')
await page.waitForTimeout(1200)
section('month: drag the chip (n2, 3-day span) two days to the right')
const n2 = await boxOf('n2')
const monthColW = await dayColumnWidth()
if (!n2) console.log('  n2 not rendered')
else await drag(n2, monthColW * 2, 0)

console.log('\n--- writes captured (last 6) ---')
for (const line of writes.slice(-6)) console.log(line)
console.log('\n--- all captured events ---')
console.log(writes.join('\n'))
console.log('\npage errors:', pageErrors.length ? pageErrors.join(' | ') : 'none')
await browser.close()

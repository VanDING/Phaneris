/**
 * Diagnostic: what does FullCalendar v7 hand to `select` / `dateClick`?
 *
 * Captures the console protocol emitted by the probe build of CalendarView for
 * three gestures: a plain click on an empty 30-minute slot, a drag across two
 * slots, and a drag across days in the month grid.
 *
 * Usage: node plans/calendar-select-probe.mjs [base]
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5199'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const events = []
page.on('console', (message) => {
  const text = message.text()
  if (text.includes('[PROBE')) events.push(text)
})
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

const geometry = () => page.evaluate(() => {
  // The time grid's slot lanes carry the wall-clock time they start at. Two
  // elements carry `data-time`: the 47px time-axis label (inert) and the lane
  // itself, which spans every day column — so the lane is the wide one.
  const lanes = [...document.querySelectorAll('[data-time]')]
    .map((el) => ({ el, time: el.getAttribute('data-time'), rect: el.getBoundingClientRect() }))
    .filter((s) => s.rect.width > 200 && s.rect.height > 10 && s.rect.top > 100 && s.rect.bottom < window.innerHeight)
  const lane = lanes.find((s) => s.time?.startsWith('10:00')) ?? lanes[0]
  const monthCell = [...document.querySelectorAll(".phaneris-calendar [role='gridcell']")]
    .find((c) => c.getBoundingClientRect().height > 100 && c.getAttribute('data-date'))
  const mr = monthCell?.getBoundingClientRect()
  return {
    laneCount: lanes.length,
    laneTimes: lanes.slice(0, 3).map((s) => `${s.time}@y${Math.round(s.rect.top)}h${Math.round(s.rect.height)}`),
    // Middle of the fourth day column of the lane.
    daySlot: lane ? {
      x: lane.rect.x + (lane.rect.width * 3.5) / 7,
      y: lane.rect.y + lane.rect.height / 2,
      h: lane.rect.height,
      time: lane.time,
    } : null,
    monthCell: mr ? { x: mr.x + mr.width / 2, y: mr.y + mr.height / 2 } : null,
  }
})

const marker = (label) => events.push(`### ${label}`)

const dragBy = async (x, y, dy) => {
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(x, y + (dy / 10) * i)
    await page.waitForTimeout(18)
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
}

// --- week view ---
await selectRadio('Week')
await page.waitForTimeout(1000)
let geo = await geometry()
console.log("week geometry:", JSON.stringify({ laneCount: geo.laneCount, laneTimes: geo.laneTimes, daySlot: geo.daySlot }))
marker('week: plain click on the 10:00 slot')
await page.mouse.click(geo.daySlot.x, geo.daySlot.y)
await page.waitForTimeout(600)
marker('week: drag down two 30-minute slots')
await dragBy(geo.daySlot.x, geo.daySlot.y, geo.daySlot.h * 2)
marker('week: drag down five 30-minute slots')
await dragBy(geo.daySlot.x, geo.daySlot.y, geo.daySlot.h * 5)

// --- month view ---
await selectRadio('Month')
await page.waitForTimeout(1200)
geo = await geometry()
marker('month: plain click on a day cell')
await page.mouse.click(geo.monthCell.x, geo.monthCell.y)
await page.waitForTimeout(600)
marker('month: drag across three day cells')
await page.mouse.move(geo.monthCell.x, geo.monthCell.y)
await page.mouse.down()
for (let i = 1; i <= 10; i += 1) {
  await page.mouse.move(geo.monthCell.x + 20 * i, geo.monthCell.y)
  await page.waitForTimeout(18)
}
await page.mouse.up()
await page.waitForTimeout(600)

console.log(events.join('\n'))
await browser.close()

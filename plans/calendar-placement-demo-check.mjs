/**
 * Repeatable check for the calendar side-rail prototype.
 *
 * The prototype is the thing being reviewed, so it gets the same treatment as
 * production UI: every claim about it is an assertion here rather than a
 * sentence in a message. Run it after editing the HTML.
 *
 *   node plans/calendar-placement-demo-check.mjs
 */
import { chromium } from 'playwright'

const url = 'file://' + process.cwd() + '/plans/calendar-untimed-placement-demo.html'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(400)

const results = []
const check = async (name, run) => {
  try { await run(); results.push(`PASS  ${name}`) }
  catch (error) { results.push(`FAIL  ${name} — ${error.message}`) }
}
const assert = (ok, message) => { if (!ok) throw new Error(message) }
const setView = async (name) => { await page.locator(`#views button[data-view="${name}"]`).click(); await page.waitForTimeout(220) }
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  for (let i = 1; i <= 10; i += 1) { await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10); await page.waitForTimeout(16) }
  await page.mouse.up(); await page.waitForTimeout(250)
}
const lastLog = async () => (await page.locator('.log .row').first().textContent()) ?? ''
const railChipCount = () => page.locator('.rail .chip').count()
const headerBox = () => page.locator('#head').boundingBox()
/** No chip may escape the box it belongs to. */
const containmentIssues = () => page.evaluate(() => {
  const rect = (n) => n.getBoundingClientRect()
  const inside = (a, b) => a.x >= b.x - 1 && a.right <= b.right + 1 && a.y >= b.y - 1 && a.bottom <= b.bottom + 1
  const bad = []
  document.querySelectorAll('.rail .chip').forEach((c) => { if (!inside(rect(c), rect(c.closest('.rail-day') ?? document.querySelector('#rail')))) bad.push(`rail: ${c.textContent}`) })
  document.querySelectorAll('.col .chip').forEach((c) => { if (!inside(rect(c), rect(c.closest('.col')))) bad.push(`col: ${c.textContent}`) })
  document.querySelectorAll('.month .chip').forEach((c) => { if (!inside(rect(c), rect(c.closest('.mcell')))) bad.push(`month: ${c.textContent}`) })
  return bad
})

// ------------------------------------------------- the header, in 3 views
const headerHeights = {}
for (const v of ['day', 'week', 'month']) {
  await setView(v)
  headerHeights[v] = Math.round((await headerBox()).height)
}
await check('the header band is exactly the same height in 日 / 周 / 月', async () => {
  const values = Object.values(headerHeights)
  assert(new Set(values).size === 1, `heights differ: ${JSON.stringify(headerHeights)}`)
  assert(values[0] === 52, `expected the 52px band, measured ${values[0]}`)
})
await check('日/周 header is two lines (weekday over date), 月 is weekday only', async () => {
  await setView('week')
  const week = await page.evaluate(() => {
    const cell = document.querySelector('#head .hd')
    return { cells: document.querySelectorAll('#head .hd').length, wd: cell.querySelector('.wd')?.textContent, dt: cell.querySelector('.dt')?.textContent }
  })
  assert(week.cells === 7, `week header should have 7 cells, saw ${week.cells}`)
  assert(/^周[一二三四五六日]$/.test(week.wd ?? ''), `weekday line missing: ${week.wd}`)
  assert(/^\d+\/\d+$/.test(week.dt ?? ''), `date line missing: ${week.dt}`)

  await setView('day')
  const day = await page.evaluate(() => ({ cells: document.querySelectorAll('#head .hd').length, cols: document.querySelectorAll('.col').length }))
  assert(day.cells === 1 && day.cols === 1, `day view should be a single column, saw ${day.cells}/${day.cols}`)

  await setView('month')
  const month = await page.evaluate(() => {
    const cell = document.querySelector('#head .hd')
    return { cells: document.querySelectorAll('#head .hd').length, hasDate: Boolean(cell.querySelector('.dt')), wd: cell.querySelector('.wd')?.textContent }
  })
  assert(month.cells === 7, `month header should be 7 cells, saw ${month.cells}`)
  assert(!month.hasDate, 'month header must not carry a date line')
  assert(/^周[一二三四五六日]$/.test(month.wd ?? ''), `month weekday missing: ${month.wd}`)
})
await check('today is marked in the header, and only today', async () => {
  await setView('week')
  const marked = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#head .hd')]
    return cells.map((c, i) => (c.classList.contains('today') ? i : -1)).filter((i) => i >= 0)
  })
  assert(marked.length === 1, `expected exactly one today cell, saw ${marked.length}`)
})
await check('the day view is NOT washed with the today tint; the week view still locates today', async () => {
  await setView('day')
  const dayTinted = await page.locator('.col.today').count()
  assert(dayTinted === 0, `the single day column must not be tinted, saw ${dayTinted}`)
  const dayHeaderToday = await page.locator('#head .hd.today').count()
  assert(dayHeaderToday === 1, 'the day header should still mark today in blue')

  await setView('week')
  const weekTinted = await page.locator('.col.today').count()
  assert(weekTinted === 1, `the week view should tint exactly one column, saw ${weekTinted}`)
})

// ---------------------------------------------------------- rail presence
await check('the rail exists in 日 and 周, and not in 月', async () => {
  await setView('day')
  assert(await page.locator('#rail.hidden').count() === 0, 'rail should be visible in day view')
  await setView('week')
  assert(await page.locator('#rail.hidden').count() === 0, 'rail should be visible in week view')
  await setView('month')
  assert(await page.locator('#rail.hidden').count() === 1, 'rail should be hidden in month view')
  assert(await page.locator('.month .mrow').count() >= 4, 'month grid should render week rows')
})
await check('月 view still shows the untimed entries, as day-cell chips', async () => {
  const untimedInCells = await page.locator('.month .chip.untimed').count()
  assert(untimedInCells >= 1, 'month view lost the untimed entries entirely')
})

// ------------------------------------------------------- cross-week listing
await setView('week')
await check('rail lists entries from other weeks, each with its weekday', async () => {
  const groups = await page.locator('.rail .rail-day > .d').allTextContents()
  const dates = await page.evaluate(() => [...document.querySelectorAll('.rail .chip .m')].map((n) => n.textContent.split('·').pop().trim()))
  const inVisibleWeek = await page.evaluate(() => [...document.querySelectorAll('#head .hd .dt')].map((n) => n.textContent.trim()))
  const outside = dates.filter((d) => !inVisibleWeek.includes(d))
  assert(outside.length >= 3, `expected cross-week entries, saw ${dates.join(' / ')}`)
  assert(groups.every((g) => /周[一二三四五六日]/.test(g)), `every group needs a weekday: ${groups.join(' / ')}`)
  assert(groups.some((g) => g.includes('已过期')), `no overdue group in: ${groups.join(' / ')}`)
  assert(((await page.locator('#railCount').textContent()) ?? '').includes('已过期'), 'the rail header should count the overdue ones')
})
await check('the rail is independent of which week is on screen', async () => {
  const before = await railChipCount()
  await page.locator('#next').click()
  await page.waitForTimeout(250)
  const after = await railChipCount()
  assert(before === after, `rail changed with the visible week: ${before} -> ${after}`)
  await page.locator('#today').click()
  await page.waitForTimeout(250)
})

// --------------------------------------------------------- rail quick-add
await check('rail + writes a date-only entry and lands in its day group', async () => {
  const before = await railChipCount()
  await page.locator('#addOpen').click()
  await page.locator('#addTitle').fill('写周报')
  await page.locator('#addDate').fill('2026-10-07')
  await page.locator('#addCommit').click()
  await page.waitForTimeout(250)
  assert(await railChipCount() === before + 1, `rail chip count ${before} -> ${await railChipCount()}`)
  const log = await lastLog()
  assert(log.includes('侧栏 + 新建'), `unexpected log: ${log}`)
  assert(log.includes('"date":"2026-10-07"') && log.includes('"allDay":true'), `unexpected payload: ${log}`)
  assert(!log.includes('"time"'), `payload must not invent a time: ${log}`)
})
await check('rail + refuses an empty title', async () => {
  await page.locator('#addTitle').fill('')
  assert(await page.locator('#addCommit').isDisabled(), 'commit should be disabled without a title')
  await page.locator('#addCancel').click()
})

// ------------------------------------------------------------ drag: rail ->
await check('rail -> grid fills the date and the time, and leaves the rail', async () => {
  const before = await railChipCount()
  const last = page.locator('.rail .chip').last()
  await last.scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  const chip = await last.boundingBox()
  const slot = await page.locator('.col .slot[data-slot="18"]').first().boundingBox()
  await drag({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 })
  assert(await railChipCount() === before - 1, `rail chip count ${before} -> ${await railChipCount()}`)
  const log = await lastLog()
  assert(log.includes('侧栏 → 网格'), `unexpected log: ${log}`)
  assert(log.includes('"time":"16:00"') && log.includes('"allDay":false'), `unexpected payload: ${log}`)
})
await check('grid -> rail clears the time and returns the entry to the rail', async () => {
  const before = await railChipCount()
  const chip = await page.locator('.col .chip').first().boundingBox()
  const railBox = await page.locator('#rail').boundingBox()
  await drag({ x: chip.x + 20, y: chip.y + 8 }, { x: railBox.x + railBox.width / 2, y: railBox.y + 220 })
  assert(await railChipCount() === before + 1, `rail chip count ${before} -> ${await railChipCount()}`)
  const log = await lastLog()
  assert(log.includes('网格 → 侧栏'), `unexpected log: ${log}`)
  assert(log.includes('"allDay":true') && !log.includes('"time"'), `unexpected payload: ${log}`)
})
await check('every chip stays inside its own container', async () => {
  const bad = await containmentIssues(); assert(bad.length === 0, bad.join(' | '))
})

// ------------------------------------------------------ selection in a day
await check('click a slot creates one hour; a vertical drag creates the range', async () => {
  const slot = await page.locator('.col .slot[data-slot="10"]').first().boundingBox()
  await page.mouse.click(slot.x + slot.width / 2, slot.y + slot.height / 2)
  await page.waitForTimeout(250)
  const clickLog = await lastLog()
  assert(clickLog.includes('单击一格') && clickLog.includes('"time":"12:00"') && clickLog.includes('"endTime":"13:00"'), `unexpected: ${clickLog}`)
  const from = await page.locator('.col .slot[data-slot="6"]').first().boundingBox()
  await drag({ x: from.x + from.width / 2, y: from.y + 4 }, { x: from.x + from.width / 2, y: from.y + 4 + 22 * 3 })
  assert((await lastLog()).includes('竖拖选区间'), `unexpected: ${await lastLog()}`)
})

// ------------------------------------------------------------- month grid
await setView('month')
await check('month cell click creates a date-only entry', async () => {
  const cell = await page.locator('.month .mcell:not(.other)').nth(10).boundingBox()
  await page.mouse.click(cell.x + cell.width - 12, cell.y + cell.height - 12)
  await page.waitForTimeout(250)
  const log = await lastLog()
  assert(log.includes('月视图点日格'), `unexpected log: ${log}`)
  assert(log.includes('"allDay":true') && !log.includes('"time"'), `unexpected payload: ${log}`)
})
await check('month -> month drag moves the entry to another day', async () => {
  const chip = await page.locator('.month .chip.untimed').first().boundingBox()
  const target = await page.locator('.month .mcell:not(.other)').nth(20).boundingBox()
  await drag({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, { x: target.x + target.width / 2, y: target.y + target.height / 2 })
  const log = await lastLog()
  assert(log.includes('月视图拖动'), `unexpected log: ${log}`)
  assert(log.includes('"allDay":true'), `a drag inside month must not invent a time: ${log}`)
})
await check('every chip stays inside its own container (month)', async () => {
  const bad = await containmentIssues(); assert(bad.length === 0, bad.join(' | '))
})

// ---------------------------------------------------------------- reset
await page.locator('#reset').click()
await page.waitForTimeout(250)
await check('reset restores the seed and clears the write log', async () => {
  assert(await page.locator('.log .row').count() === 0, 'log should be empty after reset')
  await setView('week')
  assert(await railChipCount() === 7, `expected 7 seeded untimed entries, saw ${await railChipCount()}`)
})

await check('no page or console errors', async () => { assert(errors.length === 0, errors.join(' | ')) })

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\nheader heights: ${JSON.stringify(headerHeights)}`)
console.log(`${results.length - failed}/${results.length} passed`)
await browser.close()
process.exit(failed ? 1 : 0)

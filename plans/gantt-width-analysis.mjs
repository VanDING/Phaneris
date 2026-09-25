/**
 * Diagnostic: how wide is the Gantt task column, and can the user change it?
 *
 * Measures the rendered Playground, not the source:
 *   1. the grid column width vs. the chart host width, at two viewport sizes;
 *   2. whether the library's splitter (`wx-resizer`) is present and hit-testable;
 *   3. what a real mouse drag on that splitter does to the width.
 *
 * Usage: node plans/gantt-width-analysis.mjs [base]
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5199'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.addInitScript(() => {
  localStorage.setItem('playground-selected-component', 'gantt-view')
  localStorage.setItem('playground-preview-size', JSON.stringify({ width: 1400, height: 860 }))
  localStorage.setItem('playground-variants-sidebar-open', 'false')
  localStorage.setItem('i18nsetLng', 'en')
  localStorage.setItem('i18nextLng', 'en')
})
await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
await page.waitForTimeout(3500)

const measure = () => page.evaluate(() => {
  const round = (n) => Math.round(n * 100) / 100
  const host = document.querySelector('.phaneris-gantt')
  const grid = document.querySelector('.phaneris-gantt .wx-grid') ?? document.querySelector('.phaneris-gantt .wx-table')
  const firstCell = document.querySelector('.phaneris-gantt .pg-task-cell')
  const area = document.querySelector('.phaneris-gantt .wx-area')
  const resizer = document.querySelector('.phaneris-gantt .wx-resizer')
  const resizerLine = document.querySelector('.phaneris-gantt .wx-resizer-line')
  const expandButtons = [...document.querySelectorAll('.phaneris-gantt .wx-button-expand-box *')]
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }
  }
  const style = (el) => {
    if (!el) return null
    const s = getComputedStyle(el)
    return { display: s.display, visibility: s.visibility, cursor: s.cursor, width: s.width, opacity: s.opacity, pointerEvents: s.pointerEvents }
  }
  return {
    viewportWidth: window.innerWidth,
    host: rect(host),
    grid: rect(grid),
    gridStyle: style(grid),
    firstCell: rect(firstCell),
    area: rect(area),
    resizer: rect(resizer),
    resizerStyle: style(resizer),
    resizerLine: rect(resizerLine),
    expandButtonCount: expandButtons.length,
    // What the pointer actually hits at the splitter's own centre.
    hitAtResizer: (() => {
      if (!resizer) return null
      const r = resizer.getBoundingClientRect()
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}` : null
    })(),
  }
})

const before = await measure()
console.log('--- before drag ---')
console.log(JSON.stringify(before, null, 2))

// Drag the splitter 240px to the right, like a user widening the task list.
let drag = null
if (before.resizer) {
  const startX = before.resizer.x + before.resizer.w / 2
  const y = before.resizer.y + before.resizer.h / 2
  await page.mouse.move(startX, y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(startX + (240 / 12) * step, y)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
  drag = { startX, y, movedTo: startX + 240 }
}
const afterDrag = await measure()
console.log('--- after drag (+240px) ---')
console.log(JSON.stringify({ drag, grid: afterDrag.grid, firstCell: afterDrag.firstCell, area: afterDrag.area }, null, 2))

// The view re-renders on hover (it keeps the hovered row in state, to link the
// task cell and the bar). Does the width survive a plain React re-render?
const firstRow = await page.$('.phaneris-gantt .pg-task-cell')
if (firstRow) {
  await firstRow.hover()
  await page.waitForTimeout(500)
}
const afterHover = await measure()
console.log('--- after a hover (forces a React re-render) ---')
console.log(JSON.stringify({ grid: afterHover.grid, area: afterHover.area }, null, 2))

// And a remount: switching the scale preset re-renders, leaving the view keeps
// the width only if it is persisted somewhere.
await page.evaluate(() => {
  const radio = [...document.querySelectorAll('[role="radio"]')].find((n) => n.textContent?.trim() === 'Month')
  radio?.click()
})
await page.waitForTimeout(800)
const afterScale = await measure()
console.log('--- after switching the scale preset ---')
console.log(JSON.stringify({ grid: afterScale.grid, area: afterScale.area }, null, 2))

// Now change the viewport width and see whether the task column follows.
await page.setViewportSize({ width: 1900, height: 900 })
await page.waitForTimeout(1200)
const afterResize = await measure()
console.log('--- after viewport 1400 -> 1900 ---')
console.log(JSON.stringify({ grid: afterResize.grid, firstCell: afterResize.firstCell, area: afterResize.area }, null, 2))

await browser.close()

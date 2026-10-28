#!/usr/bin/env bun
/**
 * Calendar drag / resize / live-language acceptance (CAL-01..04).
 *
 * The existing suites drag onto a slot or onto a `[role=gridcell][data-date]`
 * under an injected write FAILURE (`planning-performance-workflow.ts:134-142`),
 * and `calendar-gantt-verification.mjs:1436-1444` deliberately skips the library's
 * pointer drag with a claim that headless Chromium cannot start its interaction
 * handler. A SUCCESSFUL drag that persists the new time was therefore unproven —
 * which is exactly what this workflow drives, on the real `CalendarView` with the
 * real `useCalendarEntries` write path (`eventDrop`/`eventResize` -> `commitDates`
 * -> `update` -> `calendarPlanningFields` -> `updateWorkItem`).
 *
 *   CAL-01  real pointer drag of a timed event onto another column: the recorded
 *           write carries the target date and keeps its 10:00 start.
 *   CAL-02  real pointer resize of that event's bottom edge: the recorded end
 *           moves, the start does not.
 *   CAL-03  the `[role=gridcell][data-date]` DOM contract resolves in both the
 *           time grid and the month grid, and `@fullcalendar/react` resolves to
 *           exactly 7.1.0 in this workspace.
 *   CAL-04  `changeLanguage('zh-Hans')` while mounted: translated title/labels,
 *           events kept, nothing thrown.
 *
 * If the pointer drag does not start the library's handler, the attempt is
 * recorded with positions and callbacks, the component's own `eventDrop` /
 * `eventResize` callback is driven instead (still real product code), and the
 * limitation is written to `untested` and to the artifact. It is never skipped.
 *
 * Usage: bun run scripts/verification/upgrade-0153-calendar-drag-workflow.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'

const ENTRY = 'ev-1'
const GRID_CELL = "[role='gridcell'][data-date]"

interface Point { x: number; y: number }
interface DragAttempt {
  index: number
  from: Point
  to: Point
  steps: number
  writesBefore: number
  writesAfter: number
  changed: boolean
  durationMs: number
}

await verificationWorkflow('upgrade-0153-calendar-drag', async run => {
  const launchStarted = Date.now()
  const launched = await launchWorkflowBrowser()
  const launchMs = Date.now() - launchStarted
  console.log('[cal] browser', launched.browser.version(), `${launchMs}ms`)
  const context = await launched.browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const buildStarted = Date.now()
  const fixture = await buildFixturePage({
    runDirectory: run.directory,
    entry: 'scripts/verification/fixtures/calendar-drag.tsx',
  })
  const buildMs = Date.now() - buildStarted
  console.log('[cal] fixture page', fixture.url, 'built in', `${buildMs}ms`)

  const errors: string[] = []
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  const dragAttempts: DragAttempt[] = []
  const checks: { id: string; passed: boolean; error?: string }[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500))
  })
  page.on('requestfailed', request => {
    if (failedRequests.length < 20) failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  async function check(id: string, fn: () => Promise<void>) {
    try { await fn(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }) }
  }

  const bootStarted = Date.now()
  let booted = false
  for (let attempt = 1; attempt <= 2 && !booted; attempt += 1) {
    console.log(`[cal] boot attempt ${attempt}`)
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(error => {
      errors.push(`goto attempt ${attempt}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    })
    booted = await page.waitForFunction(() => window.calendarFixture?.ready === true, undefined, { timeout: 90_000 })
      .then(() => true).catch(() => false)
    console.log(`[cal] attempt ${attempt} ready=${booted}`)
    if (!booted) await Bun.sleep(1_000)
  }
  const bootMs = Date.now() - bootStarted
  assert(booted, `fixture page never became ready (${JSON.stringify({ errors, consoleErrors, failedRequests })})`)
  // The error bound must be real, not a race with the calendar's own first paint.
  await page.waitForSelector(`[data-calendar-entry="${ENTRY}"]`, { timeout: 30_000 })
  await page.waitForFunction(() => document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]").length > 0, undefined, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)

  const boot = await page.evaluate(() => ({
    ready: window.calendarFixture.ready,
    anchorDate: window.calendarFixture.anchorDate,
    mode: window.calendarFixture.mode(),
    title: window.calendarFixture.title(),
    eventIds: window.calendarFixture.eventIds,
    renderedEntries: [...document.querySelectorAll('[data-calendar-entry]')].map(node => node.getAttribute('data-calendar-entry')),
    gridCells: document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]").length,
    items: window.calendarFixture.items(),
  }))
  const fullCalendarVersion = JSON.parse(readFileSync(resolve(import.meta.dir, '../../node_modules/@fullcalendar/react/package.json'), 'utf8')).version as string
  run.json('boot.json', { url: fixture.url, boot, bootMs, buildMs, launchMs, fullCalendarVersion, errors, consoleErrors, failedRequests })

  /** Column geometry for the time grid: day cells wide and tall enough to be a column. */
  async function columnGeometry() {
    return await page.evaluate(selector => {
      const rectOf = (element: Element) => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      }
      const cells = [...document.querySelectorAll<HTMLElement>(`.phaneris-calendar ${selector}`)]
        .filter(node => node.getBoundingClientRect().height > 100)
        .map(node => ({ date: node.getAttribute('data-date') ?? '', rect: rectOf(node) }))
      const entry = document.querySelector<HTMLElement>('[data-calendar-entry="ev-1"]')
      const lane = [...document.querySelectorAll<HTMLElement>('[data-time]')]
        .find(node => node.getBoundingClientRect().width > 200)
      return {
        cells,
        entry: entry ? { rect: rectOf(entry), text: entry.textContent?.trim() ?? '' } : null,
        laneHeight: lane ? lane.getBoundingClientRect().height : 0,
        view: document.querySelector('.phaneris-calendar')?.getAttribute('data-calendar-view') ?? null,
      }
    }, GRID_CELL)
  }

  /** Real mouse drag in small steps; returns the recorded write count before/after. */
  async function pointerDrag(from: Point, to: Point, index: number): Promise<DragAttempt> {
    const started = Date.now()
    const writesBefore = await page.evaluate(() => window.calendarFixture.writes.length)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    const steps = 16
    for (let step = 1; step <= steps; step += 1) {
      await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps)
      await page.waitForTimeout(20)
    }
    await page.mouse.up()
    const deadline = Date.now() + 15_000
    let writesAfter = writesBefore
    while (Date.now() < deadline) {
      writesAfter = await page.evaluate(() => window.calendarFixture.writes.length)
      if (writesAfter > writesBefore) break
      await Bun.sleep(100)
    }
    const attempt = { index, from, to, steps, writesBefore, writesAfter, changed: writesAfter > writesBefore, durationMs: Date.now() - started }
    dragAttempts.push(attempt)
    return attempt
  }

  const writes = () => page.evaluate(() => window.calendarFixture.writes.map(write => ({ id: write.id, patch: write.patch, at: write.at })))
  const itemsById = async (id: string) => (await page.evaluate(() => window.calendarFixture.items())).find(item => item.id === id)

  let targetDate = ''
  let anchorDate = boot.anchorDate
  let resizeRecorded = false

  try {
    // ---------------------------------------------------------------- CAL-01 ---
    await check('CAL-01-pointer-drag-persists-new-date', async () => {
      const geometry = await columnGeometry()
      assert(geometry.entry, 'the seeded timed event (ev-1) is not rendered in the calendar')
      assert.equal(geometry.view, 'week', `the fixture must boot in the week view, got ${geometry.view}`)
      assert(geometry.cells.length >= 3, `the week grid must expose columns, found ${geometry.cells.length}`)
      const target = geometry.cells.find(cell => cell.date && cell.date !== anchorDate)
      assert(target, `no column other than the anchor (${anchorDate}) was rendered`)
      targetDate = target!.date
      const from = { x: geometry.entry!.rect.x + geometry.entry!.rect.width / 2, y: geometry.entry!.rect.y + geometry.entry!.rect.height / 2 }
      const to = { x: target!.rect.x + target!.rect.width / 2, y: from.y }
      console.log(`[cal] drag ${ENTRY} ${anchorDate} -> ${targetDate} from ${JSON.stringify(from)} to ${JSON.stringify(to)}`)
      const attempt = await pointerDrag(from, to, 1)
      run.json('cal-01-drag.json', { anchorDate, targetDate, geometry, attempt, writes: await writes() })

      let path = 'real pointer drag'
      if (!attempt.changed) {
        // Documented fallback: the pointer gesture did not start the library's
        // interaction handler. Drive the component's own callback instead of
        // dropping the scene, and say so.
        console.warn('[cal] pointer drag produced no write; falling back to the component eventDrop callback')
        const handlerFound = await page.evaluate(() => window.calendarFixture.handlerFound())
        assert(handlerFound, 'neither a pointer drag nor the component eventDrop callback could be reached')
        const fallback = await page.evaluate(({ date }) => window.calendarFixture.componentDrop('ev-1', { date, endDate: date, time: '10:00', endTime: '11:00' }), { date: targetDate })
        assert(fallback, 'the component eventDrop callback was not invoked')
        path = 'component eventDrop callback (pointer drag could not start the library handler)'
        await page.waitForFunction(() => window.calendarFixture.writes.length > 0, undefined, { timeout: 20_000 })
      }
      const recorded = await writes()
      const last = recorded[recorded.length - 1]
      assert(last, 'no write was recorded')
      assert.equal(last!.id, ENTRY)
      assert.equal(last!.patch.startAt, `${targetDate}T10:00`,
        `the drag must persist the target date and keep the 10:00 start, wrote ${JSON.stringify(last!.patch)}`)
      assert.equal(last!.patch.dueAt, `${targetDate}T11:00`,
        `the drag must keep the one-hour duration, wrote ${JSON.stringify(last!.patch)}`)
      const item = await itemsById(ENTRY)
      assert.equal(item?.startAt, `${targetDate}T10:00`, 'the host projection must hold the dragged start')
      assert.equal((await page.evaluate(() => window.calendarFixture.reverted())), 0, 'a successful write must not be reverted')
      run.json('cal-01-drag.json', { anchorDate, targetDate, geometry, attempt, path, writes: recorded })
      await page.screenshot({ path: join(run.directory, 'calendar-after-drag.png') })
      anchorDate = targetDate
    })

    // ---------------------------------------------------------------- CAL-02 ---
    await check('CAL-02-pointer-resize-changes-end-not-start', async () => {
      await page.evaluate(() => window.calendarFixture.resetWrites())
      const geometry = await columnGeometry()
      assert(geometry.entry, 'the event disappeared after the drag')
      const entryRect = geometry.entry!.rect
      // The bottom resize handle: the element under the pointer at the event's
      // bottom edge, inside the event element.
      const handle = await page.evaluate(({ x, y }) => {
        const node = document.elementFromPoint(x, y) as HTMLElement | null
        const entry = node?.closest('[data-calendar-entry]') as HTMLElement | null
        const rect = node?.getBoundingClientRect()
        return {
          tag: node?.tagName ?? null,
          className: node ? String(node.className).slice(0, 80) : null,
          insideEntry: Boolean(entry),
          y: rect ? rect.y + rect.height / 2 : null,
        }
      }, { x: entryRect.x + entryRect.width / 2, y: entryRect.bottom - 3 })
      assert(handle.insideEntry, `the bottom edge of the event must be grabbable for a resize (found ${JSON.stringify(handle)})`)
      const slotHeight = geometry.laneHeight
      assert(slotHeight > 10, `could not measure a 30-minute slot (${slotHeight}px)`)
      const from = { x: entryRect.x + entryRect.width / 2, y: entryRect.bottom - 3 }
      const to = { x: from.x, y: from.y + slotHeight * 2 }
      const attempt = await pointerDrag(from, to, 2)
      run.json('cal-02-resize.json', { handle, from, to, slotHeight, attempt, writes: await writes() })

      let path = 'real pointer resize'
      if (!attempt.changed) {
        console.warn('[cal] pointer resize produced no write; falling back to the component eventResize callback')
        const fallback = await page.evaluate(({ date }) => window.calendarFixture.componentResize('ev-1', { date, endDate: date, time: '10:00', endTime: '12:00' }), { date: anchorDate })
        assert(fallback, 'the component eventResize callback was not invoked')
        path = 'component eventResize callback (pointer resize could not start the library handler)'
        await page.waitForFunction(() => window.calendarFixture.writes.length > 0, undefined, { timeout: 20_000 })
      }
      const recorded = await writes()
      const last = recorded[recorded.length - 1]
      assert(last, 'the resize recorded no write')
      assert.equal(last!.patch.startAt, `${anchorDate}T10:00`,
        `the resize must not move the start, wrote ${JSON.stringify(last!.patch)}`)
      assert.notEqual(last!.patch.dueAt, `${anchorDate}T11:00`,
        `the resize must change the end, wrote ${JSON.stringify(last!.patch)}`)
      assert.match(String(last!.patch.dueAt), new RegExp(`^${anchorDate}T\\d{2}:\\d{2}$`), 'the end must stay a timed value on the same day')
      const endMinutes = Number(String(last!.patch.dueAt).slice(11, 13)) * 60 + Number(String(last!.patch.dueAt).slice(14, 16))
      assert(endMinutes > 11 * 60, `the resize must extend the event (end ${last!.patch.dueAt})`)
      assert(endMinutes <= 14 * 60, `the resize must stay in the dragged range (end ${last!.patch.dueAt})`)
      const item = await itemsById(ENTRY)
      assert.equal(item?.dueAt, last!.patch.dueAt, 'the host projection must hold the resized end')
      resizeRecorded = true
      run.json('cal-02-resize.json', { handle, from, to, slotHeight, attempt, path, writes: recorded })
      await page.screenshot({ path: join(run.directory, 'calendar-after-resize.png') })
    })

    // ---------------------------------------------------------------- CAL-03 ---
    await check('CAL-03-gridcell-contract-and-pinned-version', async () => {
      assert.equal(fullCalendarVersion, '7.1.0',
        `@fullcalendar/react must resolve to exactly 7.1.0, found ${fullCalendarVersion}`)
      const week = await page.evaluate(selector => ({
        all: document.querySelectorAll(`.phaneris-calendar ${selector}`).length,
        columns: [...document.querySelectorAll<HTMLElement>(`.phaneris-calendar ${selector}`)].filter(node => node.getBoundingClientRect().height > 100).length,
        dates: [...document.querySelectorAll<HTMLElement>(`.phaneris-calendar ${selector}`)].map(node => node.getAttribute('data-date')).filter(Boolean),
      }), GRID_CELL)
      assert(week.all > 0 && week.columns >= 3, `the week grid must expose ${GRID_CELL} columns (${JSON.stringify(week)})`)
      // The same contract has to hold in the month projection.
      await page.evaluate(() => {
        const radio = [...document.querySelectorAll('[role="radio"]')].find(node => node.textContent?.trim() === 'Month')
        ;(radio as HTMLElement | undefined)?.click()
      })
      await page.waitForFunction(() => document.querySelector('.phaneris-calendar')?.getAttribute('data-calendar-view') === 'month', undefined, { timeout: 30_000 })
      await page.waitForTimeout(500)
      const month = await page.evaluate(selector => ({
        all: document.querySelectorAll(`.phaneris-calendar ${selector}`).length,
        dates: [...document.querySelectorAll<HTMLElement>(`.phaneris-calendar ${selector}`)].map(node => node.getAttribute('data-date')).filter(Boolean),
      }), GRID_CELL)
      assert(month.all > 0, `the month grid must expose ${GRID_CELL} cells (${JSON.stringify(month)})`)
      assert(month.dates.length === month.all, 'every month gridcell must carry data-date')
      // Back to the week view for the language scene.
      await page.evaluate(() => {
        const radio = [...document.querySelectorAll('[role="radio"]')].find(node => node.textContent?.trim() === 'Week')
        ;(radio as HTMLElement | undefined)?.click()
      })
      await page.waitForFunction(() => document.querySelector('.phaneris-calendar')?.getAttribute('data-calendar-view') === 'week', undefined, { timeout: 30_000 })
      await page.waitForTimeout(500)
      // The documented fallback path has to resolve the callbacks the component
      // itself handed to FullCalendar, even when the pointer gesture works.
      const handlers = await page.evaluate(() => ({
        found: window.calendarFixture.handlerFound(),
        domTitle: window.calendarFixture.title(),
        libraryTitle: window.calendarFixture.fullCalendarTitle(),
      }))
      assert(handlers.found, 'the component\'s own eventDrop/eventResize callbacks must be reachable (documented fallback path)')
      assert.equal(handlers.domTitle, handlers.libraryTitle,
        `the header title must start in sync with FullCalendar's live view title (${handlers.domTitle} vs ${handlers.libraryTitle})`)
      run.json('cal-03-contract.json', { fullCalendarVersion, week, month, selector: GRID_CELL, handlers })
    })

    // ---------------------------------------------------------------- CAL-04 ---
    await check('CAL-04-language-switch-while-mounted', async () => {
      const snapshot = () => page.evaluate(() => ({
        language: window.calendarFixture.i18nLanguage(),
        title: window.calendarFixture.title(),
        libraryTitle: window.calendarFixture.fullCalendarTitle(),
        mode: window.calendarFixture.mode(),
        buttons: [...document.querySelectorAll('button')].map(node => node.textContent?.trim() ?? '').filter(Boolean),
        radios: [...document.querySelectorAll('[role="radio"]')].map(node => node.textContent?.trim() ?? ''),
        weekdays: [...document.querySelectorAll('.pg-cal-head__weekday')].map(node => node.textContent?.trim() ?? ''),
        entries: [...document.querySelectorAll('[data-calendar-entry]')].map(node => node.getAttribute('data-calendar-entry')),
        gridCells: document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]").length,
        htmlLang: document.documentElement.lang,
      }))
      const before = await snapshot()
      assert.match(before.title, /\d{4}/, `the title must be rendered before the switch (${before.title})`)
      await page.evaluate(() => window.calendarFixture.setLanguage('zh-Hans'))
      // The component chrome paints the translated label first; wait for it, then
      // measure everything (including the header title) in one snapshot.
      const switched = await page.waitForFunction(() => document.body.innerText.includes('新建日程'), undefined, { timeout: 30_000 })
        .then(() => true).catch(() => false)
      await page.waitForTimeout(1_000)
      const after = await snapshot()
      assert(switched, `the calendar chrome never re-rendered in Chinese (${JSON.stringify(after)})`)
      await page.screenshot({ path: join(run.directory, 'calendar-zh.png') })
      // And back, to prove it is a live re-render and not a one-way latch.
      await page.evaluate(() => window.calendarFixture.setLanguage('en'))
      const restoredSwitched = await page.waitForFunction(() => !document.body.innerText.includes('新建日程'), undefined, { timeout: 30_000 })
        .then(() => true).catch(() => false)
      await page.waitForTimeout(500)
      const restored = await snapshot()
      // Navigation probe: the header title is a copy of the library's live view
      // title and the persisted cursor is written from the same render, so this
      // checks both follow a plain `›` after the language work above.
      const cursorBefore = await page.evaluate(() => {
        const raw = localStorage.getItem('craft-calendar-view-state:ws-fixture')
        return raw ? (JSON.parse(raw) as { cursor?: string }).cursor ?? null : null
      })
      await page.evaluate(() => {
        const next = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.toLowerCase().includes('next') || node.textContent?.trim() === '›')
        ;(next as HTMLElement | undefined)?.click()
      })
      await page.waitForTimeout(900)
      const afterNavigate = await snapshot()
      const cursorAfter = await page.evaluate(() => {
        const raw = localStorage.getItem('craft-calendar-view-state:ws-fixture')
        return raw ? (JSON.parse(raw) as { cursor?: string }).cursor ?? null : null
      })
      // FullCalendar advances to the next week's start, which need not have the
      // old cursor's weekday (the original +7 oracle passed only on Mondays).
      const expectedCursor = await page.evaluate(() => window.calendarFixture.fullCalendarCursor())
      assert(expectedCursor && expectedCursor !== cursorBefore, 'the library cursor must advance')
      const titleAndCursor = {
        domTitleAfterLanguageSwitch: after.title,
        libraryTitleAfterLanguageSwitch: after.libraryTitle,
        domTitleAfterNavigation: afterNavigate.title,
        libraryTitleAfterNavigation: afterNavigate.libraryTitle,
        cursorBefore,
        cursorAfter,
        expectedCursor,
      }
      run.json('cal-04-language.json', { before, after, restored, afterNavigate, switched, restoredSwitched, titleAndCursor })

      assert.equal(after.language, 'zh-Hans', 'the fixture language must have switched')
      assert(after.buttons.some(text => text === '今天'), `the Today control must be translated (${JSON.stringify(after.buttons)})`)
      assert(after.buttons.some(text => text === '新建日程'), `the New Schedule control must be translated (${JSON.stringify(after.buttons)})`)
      assert.deepEqual(after.radios, ['日', '周', '月'], `the view switcher must be translated (${JSON.stringify(after.radios)})`)
      assert(after.weekdays.some(day => day.includes('周')), `the day headers must be translated (${JSON.stringify(after.weekdays)})`)
      // Chinese ranges spanning two months can use 2026/10 – 2026/11.
      // The contract is the live localized library title, not a literal 年 suffix.
      assert.notEqual(after.title, before.title, 'changing locale must update the title')
      assert.equal(after.title, after.libraryTitle, 'the localized header must track the live FullCalendar title')
      assert.deepEqual(after.entries, before.entries, 'the events must survive the language switch')
      assert.equal(after.gridCells, before.gridCells, 'the grid must keep its structure across the switch')
      assert(restoredSwitched, `the calendar never returned to English (${JSON.stringify(restored)})`)
      assert.equal(restored.title, before.title, 'switching back must restore the original localized title')
      assert.equal(restored.title, restored.libraryTitle)
      assert(restored.buttons.some(text => text === 'Today'), `the chrome must return to English (${JSON.stringify(restored.buttons)})`)
      assert.deepEqual(restored.entries, before.entries, 'the events must survive the switch back')
      // The header must track the library on plain navigation too (this is the
      // other half of the frozen-title bug this scene guards against).
      assert.notEqual(afterNavigate.title, after.title, `navigation must change the header title (${after.title} -> ${afterNavigate.title})`)
      assert.equal(afterNavigate.title, afterNavigate.libraryTitle,
        `the header title must match FullCalendar after navigation (${afterNavigate.title} vs ${afterNavigate.libraryTitle})`)
      assert.equal(cursorAfter, expectedCursor,
        `the persisted cursor must follow navigation (${cursorBefore} -> ${cursorAfter}, expected ${expectedCursor})`)
      assert.equal(errors.length, 0, `page errors during the language switch: ${errors.join(' | ')}`)
      assert.equal(consoleErrors.length, 0, `console errors during the language switch: ${consoleErrors.join(' | ')}`)
    })

    const finalItems = await page.evaluate(() => window.calendarFixture.items())
    const finalWrites = await writes()
    const fallbackPaths = [
      !dragAttempts[0]?.changed ? 'CAL-01 pointer drag' : null,
      !dragAttempts[1]?.changed ? 'CAL-02 pointer resize' : null,
    ].filter(Boolean) as string[]
    await check('CAL-05-timezones-and-DST-preserve-local-dates', async () => {
      const observations = []
      for (const timezoneId of ['America/New_York', 'Asia/Shanghai']) {
        const zoned = await launched.browser.newContext({ timezoneId, viewport: { width: 1440, height: 900 } })
        try {
          const calendar = await zoned.newPage()
          await calendar.goto(`${fixture.url}?date=2026-03-08`, { waitUntil: 'domcontentloaded' })
          await calendar.waitForFunction(() => window.calendarFixture?.ready)
          assert.equal(await calendar.evaluate(() => window.calendarFixture.anchorDate), '2026-03-08')
          for (const date of ['2026-03-08', '2026-11-01']) {
            assert(await calendar.evaluate(date => window.calendarFixture.componentDrop('ev-1', { date, endDate: date, time: '01:30', endTime: '03:30' }), date))
            await calendar.waitForFunction(date => window.calendarFixture.writes.some(write => write.patch.startAt === `${date}T01:30` && write.patch.dueAt === `${date}T03:30`), date)
          }
          observations.push({ timezoneId, writes: await calendar.evaluate(() => window.calendarFixture.writes) })
        } finally { await zoned.close() }
      }
      run.json('cal-05-timezones.json', { observations, path: 'production eventDrop callback and persistence mapping; no claim of physical pointer gesture across DST' })
    })

    run.json('calendar-drag.json', {
      checks, url: fixture.url, bootMs, buildMs, launchMs, totalMs: Date.now() - launchStarted,
      anchorDate: boot.anchorDate, targetDate, resizeRecorded, dragAttempts, writes: finalWrites, items: finalItems,
      fullCalendarVersion, pageErrors: errors, consoleErrors, failedRequests, browser: launched.browser.version(),
      pointerDragStartedLibraryHandler: fallbackPaths.length === 0,
      fallbackPaths,
    })
    run.complete(checks.filter(item => item.passed).map(item => item.id), [
      ...(fallbackPaths.length ? [
        `${fallbackPaths.join(' and ')} could not start @fullcalendar/react's interaction handler under a synthetic pointer gesture in headless Chromium; those scenes were driven through the component's own callback (documented in calendar-drag.json)`,
      ] : []),
      'drag across a month boundary / auto-scroll at the grid edge during a drag',
      'the untimed rail drop path (covered by planning workflows) and multi-day all-day resizes',
      'a rejected write reverting the bar (covered by planning-performance-workflow.ts:134-142)',
      'macOS/Linux execution and native Electron packaging',
    ])
    assert(checks.every(item => item.passed), JSON.stringify(checks.filter(item => !item.passed), null, 2))
  } finally {
    await launched.close()
    await fixture.close()
    console.log(JSON.stringify({ passed: checks.filter(item => item.passed).length, total: checks.length, output: run.directory }))
  }
})

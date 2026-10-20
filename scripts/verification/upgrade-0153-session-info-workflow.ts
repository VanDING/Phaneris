#!/usr/bin/env bun
/**
 * Session-info popover/drawer long-list scroll acceptance (SIS-01..04).
 *
 * The earlier round reviewed this surface by reading it statically. This
 * workflow mounts the real `SessionInfoPopover` — both presentations — over a
 * real `AppShellProvider`, a real seeded `sessionAtomFamily` session and a host
 * stub that answers `getSessionFiles` with 12 folders x 10 long-named files, and
 * then asserts the layout contract at runtime in a real Chromium:
 *
 *   SIS-01  popover: fixed 460px box, exactly one vertical scroller (the file
 *           tree), the list really scrolls, the last file really becomes visible
 *           and the popover itself does not move.
 *   SIS-02  the same under the dark theme: identical scroll geometry.
 *   SIS-03  drawer at 390x760: its own `<= 82vh` cap, exactly one scroller, the
 *           list scrolls to the last file, no horizontal scroll.
 *   SIS-04  no horizontal scrolling anywhere in the list, and no page/console
 *           error for the whole run.
 *
 * Usage: bun run scripts/verification/upgrade-0153-session-info-workflow.ts
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'

const POPOVER = '[data-slot="popover-content"]'
const DRAWER = '[data-slot="drawer-content"]'
const TRIGGER = '[data-testid="session-info-trigger"]'

await verificationWorkflow('upgrade-0153-session-info-scroll', async run => {
  // Launch the browser BEFORE the fixture build: the build runs in a Node child
  // and serves plain files, so Vite never shares this event loop with the driver.
  const launchStarted = Date.now()
  const launched = await launchWorkflowBrowser()
  const launchMs = Date.now() - launchStarted
  console.log('[sis] browser', launched.browser.version(), `${launchMs}ms`)
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const buildStarted = Date.now()
  const fixture = await buildFixturePage({
    runDirectory: run.directory,
    entry: 'scripts/verification/fixtures/session-info-scroll.tsx',
  })
  const buildMs = Date.now() - buildStarted
  console.log('[sis] fixture page', fixture.url, 'built in', `${buildMs}ms`)

  const errors: string[] = []
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
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
    console.log(`[sis] boot attempt ${attempt}`)
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(error => {
      errors.push(`goto attempt ${attempt}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    })
    booted = await page.waitForFunction(() => window.sessionInfoFixture?.ready === true, undefined, { timeout: 90_000 })
      .then(() => true).catch(() => false)
    console.log(`[sis] attempt ${attempt} ready=${booted}`)
    if (!booted) await Bun.sleep(1_000)
  }
  const bootMs = Date.now() - bootStarted
  const boot = await page.evaluate(() => ({
    ready: window.sessionInfoFixture?.ready ?? false,
    presentation: window.sessionInfoFixture?.presentation,
    counts: window.sessionInfoFixture?.counts,
    bodyText: document.body.innerText.slice(0, 200),
  }))
  run.json('boot.json', { url: fixture.url, boot, bootMs, buildMs, launchMs, errors, consoleErrors, failedRequests })
  assert(booted && boot.ready, `fixture page never became ready (${JSON.stringify({ boot, errors, consoleErrors, failedRequests })})`)
  await page.evaluate(() => document.fonts.ready)

  /** Everything measured about whichever surface is open. */
  async function surfaceReport(selector: string) {
    return await page.evaluate(selector => {
      const content = document.querySelector(selector) as HTMLElement | null
      if (!content) return null
      const rectOf = (element: Element) => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      }
      const scrollers: HTMLElement[] = []
      for (const node of content.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(node)
        if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) scrollers.push(node)
      }
      return {
        contentRect: rectOf(content),
        contentScrollWidth: content.scrollWidth,
        contentClientWidth: content.clientWidth,
        contentOverflowX: getComputedStyle(content).overflowX,
        scrollerCount: scrollers.length,
        scrollers: scrollers.map(node => ({
          className: String(node.className),
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          overflowY: getComputedStyle(node).overflowY,
          overflowX: getComputedStyle(node).overflowX,
          scrollBehavior: getComputedStyle(node).scrollBehavior,
          hasNav: Boolean(node.querySelector('nav')),
          rect: rectOf(node),
        })),
        rows: content.querySelectorAll('nav button').length,
        folders: content.querySelectorAll('nav button[aria-expanded]').length,
      }
    }, selector)
  }

  /** Scroll the single list scroller to its end and report where the last row landed. */
  async function scrollListToEnd(selector: string) {
    return await page.evaluate(async selector => {
      const content = document.querySelector(selector) as HTMLElement | null
      if (!content) return null
      const scroller = [...content.querySelectorAll<HTMLElement>('*')].find(node => {
        const style = getComputedStyle(node)
        return /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1
      })
      if (!scroller) return null
      const rows = [...content.querySelectorAll<HTMLElement>('nav button')]
      const last = rows[rows.length - 1]
      if (!last) return null
      scroller.scrollTop = scroller.scrollHeight
      // Two frames so a smooth-scroll rule (if any) and layout both settle.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))
      const rowRect = last.getBoundingClientRect()
      const containerRect = scroller.getBoundingClientRect()
      return {
        scrollTop: scroller.scrollTop,
        maxScroll: scroller.scrollHeight - scroller.clientHeight,
        lastText: last.textContent?.trim() ?? '',
        lastTitle: last.getAttribute('title') ?? '',
        rowRect: { top: rowRect.top, bottom: rowRect.bottom, left: rowRect.left, right: rowRect.right },
        containerRect: { top: containerRect.top, bottom: containerRect.bottom, left: containerRect.left, right: containerRect.right },
        fullyVisible: rowRect.top >= containerRect.top - 1 && rowRect.bottom <= containerRect.bottom + 1,
      }
    }, selector)
  }

  const openSurface = async (selector: string) => {
    await page.locator(TRIGGER).click()
    await page.waitForSelector(selector, { timeout: 30_000 })
    // Let Radix/vaul finish their entrance transition before measuring geometry.
    await page.waitForTimeout(700)
  }

  /**
   * The height chain from the file tree up to the body. When a list is clipped
   * instead of scrolled there is no single failing number — this records which
   * ancestor stopped passing a bounded height down, which is the evidence a
   * defect report needs.
   */
  async function layoutChain(selector: string) {
    return await page.evaluate(selector => {
      const content = document.querySelector(selector) as HTMLElement | null
      if (!content) return null
      const describe = (node: HTMLElement) => {
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return {
          tag: node.tagName.toLowerCase(),
          slot: node.getAttribute('data-slot'),
          className: String(node.className).slice(0, 160),
          height: Math.round(rect.height * 100) / 100,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          overflowY: style.overflowY,
          display: style.display,
          flex: `${style.flexGrow} ${style.flexShrink} ${style.flexBasis}`,
          minHeight: style.minHeight,
          maxHeight: style.maxHeight,
        }
      }
      const nav = content.querySelector('nav')
      const chain: ReturnType<typeof describe>[] = []
      let node: HTMLElement | null = nav
      while (node && node !== document.body) {
        chain.push(describe(node))
        node = node.parentElement
      }
      const contentRect = content.getBoundingClientRect()
      const scrollers: string[] = []
      const clipped: string[] = []
      for (const candidate of content.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(candidate)
        if (/(auto|scroll|overlay)/.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 1) {
          scrollers.push(String(candidate.className).slice(0, 120))
        }
        if (style.overflowY === 'hidden' && candidate.scrollHeight > candidate.clientHeight + 1) {
          clipped.push(`${String(candidate.className).slice(0, 120)} (${candidate.scrollHeight} > ${candidate.clientHeight})`)
        }
      }
      return {
        contentRect: { top: contentRect.top, bottom: contentRect.bottom, height: contentRect.height, width: contentRect.width },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollers,
        clipped,
        chain,
      }
    }, selector)
  }

  const rectsMatch = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5 && Math.abs(a.width - b.width) <= 0.5 && Math.abs(a.height - b.height) <= 0.5

  const fixtureCounts = await page.evaluate(() => window.sessionInfoFixture.counts)
  const screenshots: string[] = []
  try {
    // ---------------------------------------------------------------- SIS-01 ---
    let lightReport: Awaited<ReturnType<typeof surfaceReport>> = null
    await check('SIS-01-popover-long-list-scrolls', async () => {
      await openSurface(POPOVER)
      const before = await surfaceReport(POPOVER)
      assert(before, 'the popover content never mounted')
      lightReport = before
      assert.equal(before!.scrollerCount, 1,
        `expected exactly one vertically scrollable element inside the popover, found ${before!.scrollerCount}: ${JSON.stringify(before!.scrollers.map(s => s.className))}`)
      assert(before!.scrollers[0]!.hasNav, 'the one vertical scroller must be the file-tree container, not an inner wrapper')
      assert(Math.abs(before!.contentRect.height - 460) <= 1,
        `the popover content must be the fixed-height box (460px), measured ${before!.contentRect.height}px`)
      assert.equal(before!.scrollers[0]!.scrollHeight > before!.scrollers[0]!.clientHeight, true,
        `the long tree must overflow its container (${before!.scrollers[0]!.scrollHeight} vs ${before!.scrollers[0]!.clientHeight})`)
      assert.equal(before!.rows, fixtureCounts.folders + fixtureCounts.files,
        `every folder and file row must be rendered (${before!.rows} rows)`)
      assert.equal(before!.folders, fixtureCounts.folders, 'all 12 folders start expanded')

      const after = await scrollListToEnd(POPOVER)
      assert(after, 'no scroll container was found to scroll')
      assert(after!.scrollTop > 0, `the list did not scroll (scrollTop=${after!.scrollTop})`)
      assert(after!.maxScroll > 0, `the list has no scroll range (maxScroll=${after!.maxScroll})`)
      assert(after!.lastText.startsWith(fixtureCounts.lastFileName),
        `the last row must be the last generated file, got "${after!.lastText.slice(0, 80)}"`)
      assert(after!.fullyVisible,
        `scrolling to the end must reveal the last file (${JSON.stringify({ row: after!.rowRect, container: after!.containerRect })})`)
      assert(after!.lastTitle.startsWith(fixtureCounts.lastFilePath), 'the last row is the file the host returned last')

      const settled = await surfaceReport(POPOVER)
      assert(settled, 'the popover disappeared while scrolling')
      assert(rectsMatch(before!.contentRect, settled!.contentRect),
        `the popover itself must not move while the inner list scrolls (${JSON.stringify({ before: before!.contentRect, after: settled!.contentRect })})`)
      await page.screenshot({ path: join(run.directory, 'popover-long-light.png') })
      screenshots.push('popover-long-light.png')
    })

    // ---------------------------------------------------------------- SIS-02 ---
    await check('SIS-02-popover-dark-scroll-unchanged', async () => {
      await page.evaluate(() => window.sessionInfoFixture.setThemeMode('dark'))
      await page.waitForFunction(() => document.documentElement.classList.contains('dark'), undefined, { timeout: 30_000 })
      await page.waitForTimeout(400)
      const dark = await surfaceReport(POPOVER)
      assert(dark, 'the popover content never mounted')
      assert.equal(dark!.scrollerCount, 1, `dark theme changed the scroller count to ${dark!.scrollerCount}`)
      assert(dark!.scrollers[0]!.hasNav, 'the one vertical scroller must still be the file-tree container')
      assert(Math.abs(dark!.contentRect.height - 460) <= 1,
        `the fixed 460px box must hold in dark mode too, measured ${dark!.contentRect.height}px`)
      assert(lightReport, 'the light measurement is missing')
      assert(Math.abs(dark!.scrollers[0]!.scrollHeight - lightReport!.scrollers[0]!.scrollHeight) <= 2,
        `dark mode must not change the scroll range (${lightReport!.scrollers[0]!.scrollHeight} -> ${dark!.scrollers[0]!.scrollHeight})`)
      const after = await scrollListToEnd(POPOVER)
      assert(after, 'no scroll container was found to scroll in dark mode')
      assert(after!.scrollTop > 0 && after!.fullyVisible,
        `dark mode must scroll to the last file the same way (${JSON.stringify(after)})`)
      const settled = await surfaceReport(POPOVER)
      assert(rectsMatch(dark!.contentRect, settled!.contentRect), 'the popover moved while scrolling in dark mode')
      await page.screenshot({ path: join(run.directory, 'popover-long-dark.png') })
      screenshots.push('popover-long-dark.png')
    })

    // ---------------------------------------------------------------- SIS-03 ---
    // The drawer is its own presentation and its own viewport; reload to clear
    // the popover state and the dark theme cache before measuring it.
    await check('SIS-03-drawer-long-list-scrolls-at-390', async () => {
      await page.setViewportSize({ width: 390, height: 760 })
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForFunction(() => window.sessionInfoFixture?.ready === true, undefined, { timeout: 90_000 })
      await page.evaluate(() => window.sessionInfoFixture.setThemeMode('light'))
      await page.waitForFunction(() => !document.documentElement.classList.contains('dark'), undefined, { timeout: 30_000 })
      await page.evaluate(() => window.sessionInfoFixture.setPresentation('drawer'))
      await page.waitForFunction(() => window.sessionInfoFixture.presentation === 'drawer')
      await openSurface(DRAWER)

      // Evidence first: the screenshot and the layout chain are captured whatever
      // the assertions below decide, so a clipped drawer is reported with numbers
      // instead of a bare failure.
      const report = await surfaceReport(DRAWER)
      assert(report, 'the drawer content never mounted')
      const chain = await layoutChain(DRAWER)
      run.json('drawer-layout.json', chain)
      await page.screenshot({ path: join(run.directory, 'drawer-long-390.png') })
      screenshots.push('drawer-long-390.png')

      // User-level falsification: a wheel gesture over the list is how a person
      // would try to reach the rest of a long tree. If the tree is clipped rather
      // than scrolled, the wheel must move the last row exactly nowhere.
      const wheelProbe = await page.evaluate(async () => {
        const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement | null
        if (!content) return null
        const rows = [...content.querySelectorAll<HTMLElement>('nav button')]
        const last = rows[rows.length - 1]
        const scrollables: { what: string; overflowY: string; clientHeight: number; scrollHeight: number; scrollTop: number; rectTop: number; rectBottom: number }[] = []
        for (const node of document.querySelectorAll<HTMLElement>('*')) {
          if (node.scrollHeight <= node.clientHeight + 1) continue
          if (!node.closest('[data-slot="drawer-content"]') && node !== content) continue
          const style = getComputedStyle(node)
          const rect = node.getBoundingClientRect()
          scrollables.push({
            what: `${node.tagName.toLowerCase()}.${String(node.className).split(' ').slice(0, 2).join('.')}`,
            overflowY: style.overflowY,
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
            scrollTop: node.scrollTop,
            rectTop: Math.round(rect.top),
            rectBottom: Math.round(rect.bottom),
          })
        }
        return { lastBefore: last ? last.getBoundingClientRect().top : null, scrollables }
      })
      await page.mouse.move(195, 480)
      await page.mouse.wheel(0, 1200)
      await page.waitForTimeout(400)
      const afterWheel = await page.evaluate(() => {
        const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement | null
        if (!content) return null
        const rows = [...content.querySelectorAll<HTMLElement>('nav button')]
        const last = rows[rows.length - 1]
        return {
          lastTop: last ? last.getBoundingClientRect().top : null,
          scrollTops: [...document.querySelectorAll<HTMLElement>('*')]
            .filter(node => node.scrollHeight > node.clientHeight + 1 && (node.closest('[data-slot="drawer-content"]') || node.getAttribute('data-slot') === 'drawer-content'))
            .map(node => ({ what: String(node.className).slice(0, 60), scrollTop: node.scrollTop })),
          documentScrollY: window.scrollY,
        }
      })
      run.json('drawer-wheel.json', { wheelProbe, afterWheel })

      const cap = 0.82 * 760
      assert(report!.contentRect.height <= cap + 1,
        `the drawer must respect its own 82vh cap (${report!.contentRect.height}px > ${cap}px)`)
      assert(report!.contentRect.height > 200,
        `the drawer must actually open with content (measured ${report!.contentRect.height}px)`)
      assert.equal(report!.scrollerCount, 1,
        `expected exactly one vertically scrollable element inside the drawer, found ${report!.scrollerCount}: ${JSON.stringify(report!.scrollers.map(s => s.className))} (see drawer-layout.json; a wheel gesture moved the last row from ${wheelProbe?.lastBefore} to ${afterWheel?.lastTop} and no drawer element left scrollTop 0: ${JSON.stringify(afterWheel?.scrollTops)})`)
      assert(report!.scrollers[0]!.hasNav, 'the one vertical scroller must be the file-tree container')
      assert(report!.scrollers[0]!.scrollHeight > report!.scrollers[0]!.clientHeight,
        `the long tree must overflow the drawer (${report!.scrollers[0]!.scrollHeight} vs ${report!.scrollers[0]!.clientHeight})`)
      assert.equal(report!.contentScrollWidth <= report!.contentClientWidth, true,
        `the drawer must not scroll horizontally (${report!.contentScrollWidth} vs ${report!.contentClientWidth})`)

      const after = await scrollListToEnd(DRAWER)
      assert(after, 'no scroll container was found inside the drawer')
      assert(after!.scrollTop > 0 && after!.fullyVisible,
        `the drawer list must scroll to the last file (${JSON.stringify(after)})`)
      assert(after!.lastText.startsWith(fixtureCounts.lastFileName),
        `the drawer's last row must be the last generated file, got "${after!.lastText.slice(0, 80)}"`)
      await page.screenshot({ path: join(run.directory, 'drawer-long-390-scrolled.png') })
      screenshots.push('drawer-long-390-scrolled.png')
    })

    // ---------------------------------------------------------------- SIS-04 ---
    await check('SIS-04-no-horizontal-scroll-and-no-errors', async () => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForFunction(() => window.sessionInfoFixture?.ready === true, undefined, { timeout: 90_000 })
      await page.evaluate(() => window.sessionInfoFixture.setThemeMode('light'))
      await openSurface(POPOVER)
      const report = await surfaceReport(POPOVER)
      assert(report, 'the popover content never mounted')
      assert(report!.scrollerCount >= 1, 'the list scroller must exist')
      assert(report!.contentScrollWidth <= report!.contentClientWidth,
        `the popover must not scroll horizontally (${report!.contentScrollWidth} vs ${report!.contentClientWidth})`)
      for (const scroller of report!.scrollers) {
        assert(scroller.scrollWidth <= scroller.clientWidth,
          `the scroll container must not scroll horizontally (${scroller.scrollWidth} vs ${scroller.clientWidth})`)
      }
      const rowOverflow = await page.evaluate(selector => {
        const content = document.querySelector(selector) as HTMLElement | null
        if (!content) return null
        const rows = [...content.querySelectorAll<HTMLElement>('nav button')]
        return {
          rows: rows.length,
          overflowing: rows.filter(row => row.scrollWidth > row.clientWidth + 1).length,
          textOverflow: rows.filter(row => {
            const label = row.querySelector('span.flex-1')
            return label ? label.scrollWidth > label.clientWidth + 1 : false
          }).length,
        }
      }, POPOVER)
      assert(rowOverflow, 'no file rows were rendered')
      assert.equal(rowOverflow!.overflowing, 0, `${rowOverflow!.overflowing} rows overflow horizontally`)
      assert(rowOverflow!.textOverflow > 0,
        'a long file name must truncate inside its row rather than widen it')
      // Recorded host traffic proves the tree came from getSessionFiles, not from markup.
      const host = await page.evaluate(() => ({
        calls: window.sessionInfoFixture.calls.map(call => [call.method, ...call.args.map(String)]),
        hostApiTouchedWithoutStub: window.sessionInfoFixture.hostApiTouchedWithoutStub(),
        openedFiles: window.sessionInfoFixture.openedFiles,
      }))
      assert(host.calls.some(call => call[0] === 'getSessionFiles'), 'the file tree did not come from getSessionFiles')
      assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`)
      assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`)
      assert.equal(failedRequests.length, 0, `failed requests: ${failedRequests.join(' | ')}`)
      run.json('host-traffic.json', { ...host, pageErrors: errors, consoleErrors, failedRequests })
    })

    const final = await page.evaluate(() => ({
      language: window.sessionInfoFixture.i18nLanguage(),
      calls: window.sessionInfoFixture.calls.length,
      hostApiTouchedWithoutStub: window.sessionInfoFixture.hostApiTouchedWithoutStub(),
    }))
    run.json('session-info-scroll.json', {
      checks, screenshots, url: fixture.url, bootMs, buildMs, launchMs, totalMs: Date.now() - launchStarted,
      pageErrors: errors, consoleErrors, failedRequests, language: final.language,
      hostCalls: final.calls, hostApiTouchedWithoutStub: final.hostApiTouchedWithoutStub,
      browser: launched.browser.version(),
      // draw-layout.json and drawer-wheel.json hold the measured height chain of
      // the drawer and the wheel gesture that scrolls the list, so a future
      // regression is diagnosable without re-running by hand.
    })
    run.complete(checks.filter(item => item.passed).map(item => item.id), [
      'renaming the session through the popover title field (the debounced write path is not exercised here)',
      'the host file watcher pushing a refreshed tree (onSessionFilesChanged is recorded but not driven)',
      'opening/previewing a file from the tree (onOpenFile is wired to the shell context, not asserted)',
      'a real Electron shell window, macOS/Linux rendering and native file-manager actions',
    ])
    assert(checks.every(item => item.passed), JSON.stringify(checks.filter(item => !item.passed), null, 2))
  } finally {
    await launched.close()
    await fixture.close()
    console.log(JSON.stringify({ passed: checks.filter(item => item.passed).length, total: checks.length, output: run.directory }))
  }
})

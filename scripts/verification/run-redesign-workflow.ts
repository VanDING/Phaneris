/**
 * Run redesign — browser verification.
 *
 * Mounts the real Run panel (TrajectoryPanel → TrajectoryView → Overview,
 * Context, Decision) over deterministic fixture evidence and asserts the
 * reviewed prototype's reading paths end to end: run identity and state, the
 * context trend and occupancy, request-level context reading, decision
 * statistics and inline evidence, the 600px panel, dark mode, Chinese copy,
 * empty and failed sessions, and the tab keyboard contract.
 *
 * The fixture supplies provider-shaped evidence only; no server, model call or
 * credential is involved. Screenshots and computed measurements are written as
 * artifacts next to `report.json`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildFixturePage } from './fixture-bundle'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { PiEventAdapter } from '../../packages/shared/src/agent/backend/pi/event-adapter'

type ReviewWindow = { runRedesignFixture: {
  decisionResponse(mode: 'normal' | 'hold' | 'error'): void
  pendingDecisions(): number
  select(id: string): void
  occupancy(contextUsage: unknown, contextWindow?: number): void
} }

await verificationWorkflow('run-redesign', async run => {
  const root = resolve(import.meta.dir, '../..')
  const checks: Array<{ id: string; passed: boolean; error?: string; detail?: unknown }> = []
  const errors: string[] = []
  const prototypeCss = readFileSync(join(root, 'docs/prototypes/run-redesign-2026-10-23/styles.css'), 'utf8')
  const parseColors = (body: string) => Object.fromEntries([...body.matchAll(/--([a-z-]+):([^;{}]+)/g)].map(match => [match[1], match[2]!.trim().toLowerCase()]))
  const prototypeLight = parseColors(prototypeCss.match(/:root\{([^}]+)\}/)![1]!)
  const prototypeDark = { ...prototypeLight, ...parseColors(prototypeCss.match(/:root\[data-theme=dark\]\{([^}]+)\}/)![1]!) }
  const paletteNames = ['surface', 'canvas', 'subtle', 'line', 'strong-line', 'ink', 'muted', 'accent', 'accent-bg', 'accent-text', 'success', 'success-bg', 'warning', 'warning-bg', 'danger', 'danger-bg']
  const categoryNames = ['system', 'schemas', 'user', 'inject', 'skill', 'assistant', 'tool']
  const paletteOf = (page: import('playwright').Page) => page.locator('[data-run-view]').evaluate((node, names) => {
    const style = getComputedStyle(node)
    return Object.fromEntries(names.map(name => [name, style.getPropertyValue(`--run-${name}`).trim().toLowerCase()]))
  }, [...paletteNames, ...categoryNames.map(name => `cat-${name}`)])
  const expectedPalette = (colors: Record<string, string>) => Object.fromEntries([
    ...paletteNames.map(name => [name, colors[name]]), ...categoryNames.map(name => [`cat-${name}`, colors[name]]),
  ])

  const server = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/run-redesign.tsx' })
  const launched = await launchWorkflowBrowser()
  const url = `${server.url}?fixture=run`

  async function check(id: string, execute: () => Promise<unknown>) {
    try {
      const detail = await execute()
      checks.push({ id, passed: true, ...(detail === undefined ? {} : { detail }) })
      console.log(`PASS ${id}`)
    } catch (error) {
      checks.push({ id, passed: false, error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) })
      console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const sceneShots: string[] = []
  async function shot(page: import('playwright').Page, name: string, options: { fullPage?: boolean } = {}) {
    await settle(page)
    const path = join(run.directory, `${name}.png`)
    await page.screenshot({ path, fullPage: options.fullPage ?? false, animations: 'disabled' })
    sceneShots.push(`${name}.png`)
  }

  const tab = async (page: import('playwright').Page, name: string) => {
    await page.getByRole('tab', { name, exact: true }).click()
    await page.waitForFunction((label) => document.querySelector(`[role="tab"][aria-selected="true"]`)?.textContent?.trim() === label, name)
  }
  const visiblePanel = (page: import('playwright').Page) => page.locator('[role="tabpanel"]:not([hidden])')
  const trendGeometry = (page: import('playwright').Page, selector: string) => page.locator(selector).evaluate(node => {
    const ratios = [...node.querySelectorAll('[class*="barStack"]')].map(bar => {
      const column = bar.parentElement!, style = getComputedStyle(column)
      const available = column.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      return bar.getBoundingClientRect().height / available
    })
    return { ticks: [...node.querySelectorAll('[class*="chartY"] span')].map(tick => tick.textContent), peakFill: Math.max(...ratios) }
  })
  const trajectoryPalette = (page: import('playwright').Page) => visiblePanel(page).evaluate(node => {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
    const rgb = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const luminance = (value: number[]) => value.map(channel => {
      const v = channel / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
    const badges = [...node.querySelectorAll('[data-role-kind]')].map(badge => {
      const style = getComputedStyle(badge), fg = rgb(style.color), bg = rgb(style.backgroundColor)
      const a = luminance(fg), b = luminance(bg)
      return { kind: badge.getAttribute('data-role-kind'), contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), identity: style.getPropertyValue('--kind-color').trim() }
    })
    const spans = Object.fromEntries(['user', 'system', 'message', 'tool'].map(kind => {
      const span = node.querySelector(`button[data-kind="${kind}"]:not([data-error])`)!
      return [kind, rgb(getComputedStyle(span).backgroundColor)]
    }))
    const table = getComputedStyle(node.querySelector('table')!)
    return { spans, badges, ink: rgb(table.color), surface: rgb(table.backgroundColor) }
  })
  const settle = async (page: import('playwright').Page) => {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    // Layout animation is driven by JS; screenshot({ animations: 'disabled' })
    // alone can capture the underline beneath the previous tab.
    await page.waitForFunction(() => {
      const active = document.querySelector('[role="tab"][aria-selected="true"]')
      const underline = active?.querySelector('span[aria-hidden="true"]')
      if (!active || !underline) return true
      const target = active.getBoundingClientRect(), line = underline.getBoundingClientRect()
      return Math.abs(line.left - target.left) < 1 && Math.abs(line.width - target.width) < 1
    }, undefined, { timeout: 3000 })
  }

  try {
    /* ── wide, light ──────────────────────────────────────────────────── */
    const wideContext = await launched.browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await wideContext.newPage()
    const noise = (text: string) => /Outdated Optimize Dep|optimized dependencies changed/i.test(text)
    page.on('pageerror', error => { if (!noise(error.message)) errors.push(error.message) })
    page.on('console', message => {
      if (message.type() === 'error' && !noise(message.text())) errors.push(message.text())
    })
    await gotoWithRetry(page, url)
    await page.waitForFunction(() => (window as unknown as { runRedesignFixture?: { ready: boolean } }).runRedesignFixture?.ready === true, undefined, { timeout: 60_000 })
    await page.locator('[data-run-state]').waitFor({ timeout: 60_000 })
    await page.evaluate(() => document.fonts.ready)
    await settle(page)

    await check('R01 one toolbar holds view tabs and state without a repeated session header', async () => {
      const toolbar = page.locator('[data-run-toolbar]')
      const header = await toolbar.innerText()
      assert(!header.includes('优化会话启动延迟'), 'the workbench already names this session')
      assert.equal(await page.locator('[data-run-view] > header').count(), 0)
      assert(await toolbar.evaluate(node => node.getBoundingClientRect().height <= 44))
      const centers = await toolbar.evaluate(node => {
        const tabs = node.querySelector('[role="tablist"]')!.getBoundingClientRect()
        const state = node.querySelector('[data-run-state]')!.getBoundingClientRect()
        return { tabs: (tabs.top + tabs.bottom) / 2, state: (state.top + state.bottom) / 2, tabRight: tabs.right, stateLeft: state.left }
      })
      assert(Math.abs(centers.tabs - centers.state) < 1)
      assert(centers.tabRight <= centers.stateLeft)
      assert.match(await page.locator('[data-run-state]').innerText(), /Completed/)
      const tail = await page.locator('[data-run-scope]').innerText()
      assert.match(tail, /Turns: 5/)
      assert.match(tail, /requests: 12/)
      return { header: header.replace(/\s+/g, ' '), tail }
    })

    await check('R02 the five tabs keep their order and expose one tab stop', async () => {
      const tabs = await page.getByRole('tab').allInnerTexts()
      assert.deepEqual(tabs.map(text => text.trim()), ['Overview', 'Trajectory', 'Decision', 'Context', 'Map'])
      assert.equal(await page.locator('[role="tab"][tabindex="0"]').count(), 1)
      return tabs
    })

    await check('A00 default Run palette matches the approved HTML prototype', async () => {
      const colors = await paletteOf(page)
      assert.deepEqual(colors, expectedPalette(prototypeLight))
      return colors
    })

    await check('A01 fixed-height Run scrolls and cached panes stay hidden', async () => {
      await page.setViewportSize({ width: 600, height: 600 })
      try {
        for (const name of ['Overview', 'Context', 'Decision', 'Trajectory', 'Map']) {
          await tab(page, name)
          await settle(page)
          assert.equal(await page.getByRole('tabpanel').count(), 1, `${name}: only the active cached pane may be visible`)
          assert(await page.locator('[role="tabpanel"][hidden]').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'none')))
          assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${name}: host must not expand`)
          if (!['Overview', 'Context', 'Decision'].includes(name)) continue
          const scroller = visiblePanel(page).locator('[class*="view_"]').first()
          const before = await scroller.evaluate(node => ({ height: node.clientHeight, total: node.scrollHeight }))
          assert(before.total > before.height + 20, `${name}: content must overflow its own bounded area`)
          const headerTop = await page.locator('[data-run-state]').evaluate(node => node.getBoundingClientRect().top)
          await scroller.hover()
          await page.mouse.wheel(0, 700)
          await page.waitForFunction(() => (document.querySelector('[role="tabpanel"]:not([hidden]) [class*="view_"]')?.scrollTop ?? 0) > 0, undefined, { timeout: 2000 })
          assert.equal(await page.locator('[data-run-state]').evaluate(node => node.getBoundingClientRect().top), headerTop)
          await scroller.evaluate(node => { node.scrollTop = node.scrollHeight })
          assert(await scroller.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop < 2), `${name}: last content is reachable`)
          await scroller.evaluate(node => { node.scrollTop = 0 })
        }
      } finally {
        await page.setViewportSize({ width: 1280, height: 1000 })
        await tab(page, 'Overview')
      }
    })

    await check('R03 overview reports five scoped metrics', async () => {
      const metrics = page.locator('[data-run-metric]')
      assert.equal(await metrics.count(), 5)
      const text = await metrics.allInnerTexts()
      assert.match(text[0]!, /Session span[\s\S]*3m 38s/)
      assert.match(text[1]!, /First output · P50[\s\S]*\d+\s*ms/)
      assert.match(text[2]!, /Metered tokens[\s\S]*718K/)
      assert.match(text[3]!, /Tool calls[\s\S]*\d+[\s\S]*Failed calls: 1/)
      assert.match(text[4]!, /Known cost[\s\S]*\$0\.018/)
      return text
    })

    await check('R04 context evolution plots every request and marks the compaction', async () => {
      const bars = page.locator('[data-run-context-trend] [data-trend-bar]')
      assert.equal(await bars.count(), 12)
      const marker = await page.locator('[data-run-context-trend] [class*="eventMarker"]').allInnerTexts()
      assert.deepEqual(marker, ['Compacted'])
      const labels = await bars.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
      assert(labels[0]!.includes('Request 1'))
      assert(labels[11]!.includes('Request 12'))
      return { labels: labels.slice(0, 2) }
    })

    await check('A09 trend axes follow observed data while occupancy keeps the complete window', async () => {
      try {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.select('run-scale'))
        await tab(page, 'Overview')
        await page.locator('[data-run-context-trend] [data-trend-bar="69"]').waitFor()
        const overview = await trendGeometry(page, '[data-run-context-trend]')
        assert.equal(overview.ticks[0], '400K')
        assert(Math.abs(overview.peakFill - 0.875) < 0.01)
        assert.match(await page.locator('[data-run-occupancy]').innerText(), /35\.0%/)
        await shot(page, 'overview-69-requests-window-1m')
        await tab(page, 'Context')
        const context = await trendGeometry(page, '[data-run-context-history]')
        assert.deepEqual(context.ticks, overview.ticks)
        assert(Math.abs(context.peakFill - overview.peakFill) < 0.01)
        await shot(page, 'context-69-requests-window-1m')
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.select('run-review'))
        await tab(page, 'Overview')
        await page.locator('[data-run-context-trend] [data-trend-bar="3"]').waitFor()
        const small = await trendGeometry(page, '[data-run-context-trend]')
        assert.equal(small.ticks[0], '400')
        assert(small.peakFill > 0.7)
        await tab(page, 'Context')
        await page.getByRole('button', { name: 'Net change', exact: true }).click()
        const deltaMaximum = await page.locator('[data-run-context-history] [class*="chartY"] span').first().innerText()
        assert(/^\+\d+$/.test(deltaMaximum) && Number(deltaMaximum) >= 100 && Number(deltaMaximum) < 1000, deltaMaximum)
        return { overview, context, small }
      } finally {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.select('run-main'))
        await tab(page, 'Overview')
      }
    })

    await check('A10 trajectory uses the Run categories with readable badges and red failures', async () => {
      await tab(page, 'Trajectory')
      try {
        await page.getByRole('button', { name: 'Expand calls', exact: true }).click()
        await visiblePanel(page).locator('[data-role-kind="tool"]').first().waitFor()
        const colors = await trajectoryPalette(page)
        assert.deepEqual(colors.spans, { user: [34, 197, 94], system: [99, 102, 241], message: [59, 130, 246], tool: [20, 184, 166] })
        assert.deepEqual(colors.ink, [34, 38, 48])
        assert.deepEqual(colors.surface, [255, 255, 255])
        for (const badge of colors.badges) assert(badge.contrast >= 4.5, `${badge.kind} contrast ${badge.contrast}`)
        await shot(page, 'trajectory-light-palette')
        await visiblePanel(page).getByRole('button', { name: 'Errors', exact: true }).click()
        const error = visiblePanel(page).locator('tr[data-error="true"] [data-role-kind]').first()
        await error.waitFor()
        assert.equal(await error.evaluate(node => getComputedStyle(node).getPropertyValue('--kind-color').trim()), '#b63e4c')
        await shot(page, 'trajectory-error-palette')
        return colors
      } finally {
        await visiblePanel(page).getByRole('button', { name: 'All', exact: true }).click()
        await page.getByRole('button', { name: 'Collapse calls', exact: true }).click()
        await tab(page, 'Overview')
      }
    })

    await check('R05 selecting a trend bar focuses that request in Context', async () => {
      await page.locator('[data-run-context-trend] [data-trend-bar="6"]').click()
      await settle(page)
      const selection = await page.locator('[data-run-context-trend] [class*="trendSelection"]').innerText()
      assert.match(selection, /Request #6/)
      await page.getByRole('button', { name: 'View this request', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Context'))
      const picker = page.locator('select[aria-label="Select model request"]')
      assert.equal(await picker.inputValue(), '6')
      return selection.replace(/\s+/g, ' ')
    })

    await check('R06 context lists seven categories and their estimated shares', async () => {
      await page.locator('select[aria-label="Select model request"]').selectOption('12')
      await settle(page)
      const folds = page.locator('[data-context-category]')
      assert.equal(await folds.count(), 7)
      const categories = await folds.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-context-category')))
      assert.deepEqual(categories, ['system', 'schemas', 'user', 'inject', 'skill', 'assistant', 'tool'])
      const composition = await page.locator('[data-run-context-browser] [class*="foldComposition"] span').count()
      assert.equal(composition, 7)
      const shares = await folds.evaluateAll(nodes => nodes.map(node => node.textContent ?? ''))
      assert(shares.every(text => /\d+(\.\d)?%/.test(text)), `every category states a share: ${shares.join(' | ')}`)
      return { categories, composition }
    })

    await check('R07 compact context rows expand parameters and result on demand', async () => {
      const toolFold = page.locator('[data-context-category="tool"]')
      await toolFold.locator('> summary').click()
      await page.waitForFunction(() => document.querySelector('[data-context-category="tool"]')?.hasAttribute('open'))
      await toolFold.locator('[data-context-item]').nth(7).waitFor()
      assert((await toolFold.locator('[data-context-item]').count()) >= 8)
      assert.equal(await toolFold.locator('[class*="readerContent"]').count(), 0, 'collapsed rows mount no prose')
      const failedItem = page.locator('[data-context-item="tool:t8"]')
      const row = failedItem.locator('[data-context-row]')
      await row.focus()
      await page.keyboard.press('Enter')
      await failedItem.locator('[data-context-content]').waitFor()
      assert.equal(await row.getAttribute('aria-expanded'), 'true')
      assert.match(await failedItem.innerText(), /Failed/)
      assert.match(await failedItem.locator('[data-context-arguments]').innerText(), /path[\s\S]*first-output.ts/)
      assert.match(await failedItem.locator('[data-context-result]').innerText(), /ENOENT/)
      assert.equal(await failedItem.locator('[class*="segmented"]').count(), 0, 'no per-message view switch')
      assert.match(await failedItem.innerText(), /Arguments/)
      const search = toolFold.getByRole('searchbox')
      await search.fill('first-output.ts')
      await page.waitForFunction(() => document.querySelectorAll('[data-context-category="tool"] [data-context-item]').length === 1)
      assert.equal(await failedItem.count(), 1)
      await search.fill('no-such-retained-entry')
      await page.waitForFunction(() => document.querySelectorAll('[data-context-category="tool"] [data-context-item]').length === 0)
      await search.fill('')
      await toolFold.locator('[data-context-item]').nth(7).waitFor()
      await shot(page, 'context-tool-list-expanded')
      const browser = page.locator('[data-run-context-browser]')
      assert.equal(await browser.locator('[class*="segmented"] button').count(), 2)
      await browser.getByRole('button', { name: 'Changes', exact: true }).click()
      assert.equal(await browser.getByRole('button', { name: 'Changes', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.equal(await failedItem.count(), 0, 'unchanged tool results are omitted in Changes')
      await toolFold.locator('[data-context-item="tool:t9"]').waitFor()
      assert.equal(await toolFold.locator('[data-context-item="tool:t9"]').getAttribute('data-change'), 'added')
      await shot(page, 'context-request-changes')
      await browser.getByRole('button', { name: 'Original', exact: true }).click()
      // The request switch keeps the expansion state.
      await page.locator('select[aria-label="Select model request"]').selectOption('12')
      await settle(page)
      assert(await page.locator('[data-context-category="tool"]').evaluate(node => node.hasAttribute('open')))
      return 'read / raw / diff verified'
    })

    await check('R08 net-change mode plots signed deltas and the compaction drop', async () => {
      await page.getByRole('button', { name: 'Net change', exact: true }).click()
      await page.waitForFunction(() => document.querySelectorAll('[data-run-context-history] [data-trend-bar]').length === 12)
      const bar = page.locator('[data-run-context-history] [data-trend-bar="9"]')
      const label = await bar.getAttribute('aria-label')
      assert(label?.includes('−52.4K'), `expected a −52.4K drop at request 9, got ${label}`)
      assert.equal(await page.locator('[data-run-context-history] [class*="deltaBar"]').count(), 12)
      await bar.click()
      await page.waitForFunction(() => (document.querySelector('select[aria-label="Select model request"]') as HTMLSelectElement | null)?.value === '9')
      await page.getByRole('button', { name: 'Cumulative composition', exact: true }).click()
      return label
    })

    await check('R09 context events link back to the request that changed the context', async () => {
      const events = page.locator('[class*="contextEvents"] [class*="eventLink"]')
      const count = await events.count()
      assert(count >= 3, `expected compaction and prompt events, found ${count}`)
      const texts = await events.allInnerTexts()
      assert(texts.some(text => /#9 compacted history −?\d/.test(text.replace(/\s+/g, ' '))), texts.join(' | '))
      assert.equal(texts.filter(text => /system prompt changed/.test(text)).length, 2)
      await events.filter({ hasText: 'compacted history' }).first().click()
      await page.waitForFunction(() => (document.querySelector('select[aria-label="Select model request"]') as HTMLSelectElement | null)?.value === '9')
      return texts
    })

    await check('R10 overview occupancy uses provider metering and estimated splits', async () => {
      await tab(page, 'Overview')
      const occupancy = page.locator('[data-run-occupancy]')
      const text = await occupancy.innerText()
      assert.match(text, /41\.3K/)
      assert.match(text, /32\.3%/)
      assert.match(text, /Free 86\.7K/)
      assert.equal(await occupancy.locator('[data-context-segment]').count(), 7)
      assert.equal(await occupancy.locator('[data-category-legend]').count(), 7)
      assert.match(text, /provider metering/)
      await shot(page, 'wide-overview-light')
      // A category in the occupancy legend opens Context with that fold revealed.
      await page.locator('[data-category-legend="tool"]').click()
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Context'))
      await page.waitForFunction(() => document.querySelector('[data-context-category="tool"]')?.hasAttribute('open'))
      await page.locator('[data-context-category="tool"] > summary').click()
      await tab(page, 'Overview')
      await page.locator('[data-category-legend="tool"]').click()
      await page.waitForFunction(() => document.querySelector('[data-context-category="tool"]')?.hasAttribute('open'))
      await tab(page, 'Overview')
      return text.replace(/\s+/g, ' ').slice(0, 240)
    })

    await check('A07 SDK capacity reaches Run without a ledger window and survives compaction', async () => {
      const adapter = new PiEventAdapter()
      const [event] = [...adapter.adaptContextUsage({
        contextUsage: { tokens: 45_000, contextWindow: 128_000 },
        compactionSettings: { enabled: true, reserveTokens: 16_000 },
      })]
      assert(event?.type === 'context_usage')
      try {
        await page.evaluate(snapshot => (window as unknown as ReviewWindow).runRedesignFixture.occupancy(snapshot), event.contextUsage)
        const card = page.locator('[data-run-occupancy]')
        await page.waitForFunction(() => document.querySelector('[data-run-occupancy]')?.textContent?.includes('32.3%'), undefined, { timeout: 3000 })
        const text = await card.innerText()
        assert.match(text, /41\.3K/)
        assert.match(text, /Free 86\.7K/)
        assert(!text.includes('112K'), 'compaction threshold must not be used as the full window')
        const fill = await card.locator('[data-context-segment]').evaluateAll(nodes => {
          const bar = nodes[0]!.parentElement!.getBoundingClientRect().width
          return nodes.reduce((sum, node) => sum + node.getBoundingClientRect().width, 0) / bar
        })
        assert(Math.abs(fill - 41_300 / 128_000) < 0.005, `unexpected actual bar fill ${fill}`)
        await shot(page, 'overview-sdk-full-window')
        // Live SDK occupancy can become unknown after compaction. The latest
        // completed request remains 41.3K; neither 45K nor null replaces it.
        const [stale] = [...adapter.adaptContextUsage({}, true)]
        assert(stale?.type === 'context_usage')
        await page.evaluate(snapshot => (window as unknown as ReviewWindow).runRedesignFixture.occupancy(snapshot), stale.contextUsage)
        await page.waitForFunction(() => document.querySelector('[data-run-occupancy]')?.textContent?.includes('32.3%'), undefined, { timeout: 3000 })
        return { sdkSnapshot: event.contextUsage, afterCompaction: stale.contextUsage, fill, latestRequestInput: 41_300 }
      } finally {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.occupancy(undefined, 128_000))
      }
    })

    await check('A08 a legacy compaction threshold never becomes a model window', async () => {
      try {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.occupancy({
          usedTokens: 45_000, limitTokens: 112_000, limitKind: 'compaction', isEstimate: true, isStale: false, canCompact: true,
        }))
        const card = page.locator('[data-run-occupancy]')
        await page.waitForFunction(() => document.querySelector('[data-run-occupancy]')?.textContent?.includes('Context window not recorded'), undefined, { timeout: 3000 })
        assert(!/\d+\.\d+%/.test(await card.innerText()))
        await shot(page, 'overview-legacy-window-unknown')
      } finally {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.occupancy(undefined, 128_000))
      }
    })

    await check('R11 output performance keeps a weighted rate and leaves gaps empty', async () => {
      const card = page.locator('[data-run-performance]')
      const text = await card.innerText()
      assert.match(text, /valid samples: 11\/12/)
      assert.equal(await card.locator('svg polyline').count(), 2, 'the legacy request breaks the rate line')
      assert.match(text, /tokens \/ s · weighted average/)
      return text.replace(/\s+/g, ' ').slice(0, 200)
    })

    await check('R12 decision impact reports scope, outcomes and the failure highlight', async () => {
      const card = page.locator('[data-run-decision-impact]')
      await page.waitForFunction(() => document.querySelector('[data-run-decision-impact]')?.textContent?.includes('decision points'))
      const text = await card.innerText()
      assert.match(text, /7[\s\S]*decision points[\s\S]*auxiliary requests: 7/)
      assert.match(text, /Actually changed 2/)
      assert.match(text, /Unconfirmed 2/)
      assert.match(text, /\$0\.001/)
      assert.match(text, /Failed or timed-out auxiliary requests: 2/)
      assert.match(text, /requests without cost: 3/)
      return text.replace(/\s+/g, ' ')
    })

    await check('R13 the failure highlight opens failed requests in the Decision tab', async () => {
      await page.getByRole('button', { name: 'Inspect', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Decision'))
      const outcome = page.locator('select[aria-label="Filter decisions by actual handling"]')
      await page.waitForFunction(() => (document.querySelector('select[aria-label="Filter decisions by actual handling"]') as HTMLSelectElement | null)?.value === 'failed')
      assert.equal(await outcome.inputValue(), 'failed')
      await page.waitForFunction(() => document.querySelectorAll('[data-decision-id]').length === 2)
      const ids = await page.locator('[data-decision-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-decision-id')).sort())
      assert.deepEqual(ids, ['dec_000', 'dec_006'])
      await shot(page, 'wide-decision-failed')
      return 'failed requests, including failures that fell back'
    })

    await check('R14 decision statistics stay read-only and scope-level', async () => {
      const results = page.locator('[data-decision-results]')
      const text = await results.innerText()
      assert.match(text, /7[\s\S]*decision points[\s\S]*auxiliary requests: 7/)
      assert.match(text, /\$0\.001/)
      assert.equal(await page.locator('[data-decision-results] button, [data-decision-features] button').count(), 0, 'statistic cards expose no actions')
      assert.equal(await page.locator('[data-decision-features] [data-feature]').count(), 6)
      const unknownFeature = await page.locator('[data-feature="guardedMode"]').innerText()
      assert.match(unknownFeature, /Unknown/)
      assert(!unknownFeature.includes('$0.0000'), 'missing metering is not a recorded zero cost')
      return text.replace(/\s+/g, ' ').slice(0, 200)
    })

    await check('R15 ledger filters by function and by actual handling', async () => {
      await page.locator('select[aria-label="Filter decisions by actual handling"]').selectOption('all')
      await page.locator('select[aria-label="Filter decisions by feature"]').selectOption('guardedMode')
      await page.waitForFunction(() => document.querySelectorAll('[data-decision-id]').length === 2)
      await page.locator('select[aria-label="Filter decisions by actual handling"]').selectOption('fallback')
      await page.waitForFunction(() => document.querySelectorAll('[data-decision-id]').length === 1)
      await page.locator('select[aria-label="Filter decisions by feature"]').selectOption('all')
      await page.locator('select[aria-label="Filter decisions by actual handling"]').selectOption('all')
      await page.waitForFunction(() => document.querySelectorAll('[data-decision-id]').length === 7)
      await shot(page, 'wide-decision-light')
      return 'filters verified'
    })

    await check('A02 filtered loading and errors never expose the unfiltered ledger', async () => {
      try {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.decisionResponse('hold'))
        await page.locator('select[aria-label="Filter decisions by feature"]').selectOption('guardedMode')
        await page.waitForFunction(() => (window as unknown as ReviewWindow).runRedesignFixture.pendingDecisions() > 0)
        assert.equal(await page.locator('[data-decision-id]').count(), 0, 'pending filtered requests must not show all records')
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.decisionResponse('error'))
        await page.getByRole('button', { name: 'Retry', exact: true }).waitFor({ timeout: 3000 })
        assert.equal(await page.locator('[data-decision-id]').count(), 0)
        assert.equal(await page.locator('[data-decision-results]').count(), 1)
        assert(!(await page.locator('[data-decision-results]').innerText()).includes('$0.0000'))
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.decisionResponse('normal'))
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await page.waitForFunction(() => document.querySelectorAll('[data-decision-id]').length === 2)
      } finally {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.decisionResponse('normal'))
        await page.locator('select[aria-label="Filter decisions by feature"]').selectOption('all')
        await page.waitForFunction(() => document.querySelectorAll('[data-decision-id]').length === 7)
      }
    })

    await check('R16 a record expands in place into three evidence steps and its diagnostics', async () => {
      const row = page.locator('[data-decision-id="dec_005"]')
      await row.getByRole('button').first().click()
      await page.waitForFunction(() => document.querySelector('[data-decision-id="dec_005"] [role="region"]'))
      assert.equal(await row.locator('[data-evidence-step]').count(), 3)
      const detail = await row.locator('[role="region"]').innerText()
      assert.match(detail, /Handling evidence/)
      assert.match(detail, /Session turn turn-2/)
      assert.match(detail, /Set session status: needs-review/)
      assert.match(detail, /confidence[\s\S]*0.82/)
      assert.match(detail, /statusReason[\s\S]*confirmed/)
      assert.match(detail, /Later observations[\s\S]*suggestion used[\s\S]*messageCount[\s\S]*2/)
      assert.match(detail, /Auxiliary request and metering detail/)
      await row.locator('[class*="requestDetails"] > summary').click()
      await row.locator('[data-decision-raw] summary').click()
      assert.match(await row.locator('[data-decision-raw]').innerText(), /"id": "dec_005"/)
      await shot(page, 'wide-decision-evidence')
      const expanded = await row.getByRole('button').first().getAttribute('aria-expanded')
      assert.equal(expanded, 'true')
      await row.getByRole('button').first().click()
      await page.waitForFunction(() => !document.querySelector('[data-decision-id="dec_005"] [role="region"]'))
      return { detail: detail.replace(/\s+/g, ' ').slice(0, 200) }
    })

    await check('R17 decision evidence opens the related request context', async () => {
      const row = page.locator('[data-decision-id="dec_005"]')
      if (await row.locator('[role="region"]').count() === 0) await row.getByRole('button').first().click()
      await page.waitForFunction(() => document.querySelector('[data-decision-id="dec_005"] [role="region"]'))
      await row.getByRole('button', { name: 'View related context' }).click()
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Context'))
      const picker = page.locator('select[aria-label="Select model request"]')
      await page.waitForFunction(() => (document.querySelector('select[aria-label="Select model request"]') as HTMLSelectElement | null)?.value === '5')
      assert.equal(await picker.inputValue(), '5')
      await shot(page, 'wide-context-light')
      return 'context focused at request 5'
    })

    await check('R18 diagnostics and environment state scope and missing data', async () => {
      await tab(page, 'Overview')
      const diagnostics = await page.locator('[data-run-diagnostics]').innerText()
      assert.match(diagnostics, /Current goal[\s\S]*总结目前证据与下一步/)
      assert.match(diagnostics, /13 \/ 0/)
      assert.match(diagnostics, /Compactions: 1 · prompt changes: 2/)
      assert.match(diagnostics, /Budgets: 1 · repeated signals: 1/)
      assert.match(diagnostics, /Failed records: 1/)
      assert.match(diagnostics, /Slowest tool/)
      assert.match(diagnostics, /2.8 s/)
      const environment = await page.locator('[data-run-environment]').innerText()
      assert.match(environment, /deepseek-flash \/ deepseek-official/)
      assert.match(environment, /Guarded/)
      assert.match(environment, /E:\\Phaneris/)
      assert.match(environment, /Cumulative tokens include repeated context/)
      await shot(page, 'wide-overview-selection')
      return { diagnostics: diagnostics.replace(/\s+/g, ' ').slice(0, 240) }
    })

    await check('R19 tabs answer ArrowRight and keep selection with focus', async () => {
      const overview = page.getByRole('tab', { name: 'Overview', exact: true })
      await overview.focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab'
        && document.activeElement?.getAttribute('aria-selected') === 'true'
        && document.activeElement?.textContent?.includes('Trajectory'))
      await page.keyboard.press('Home')
      await page.waitForFunction(() => document.activeElement?.textContent?.includes('Overview'))
      await tab(page, 'Context')
      await shot(page, 'wide-context-expanded')
      return 'roving focus verified'
    })

    await check('R20 a running session states the statistics boundary', async () => {
      await tab(page, 'Overview')
      await page.evaluate(() => (window as unknown as { runRedesignFixture: { processing(value: boolean): void } }).runRedesignFixture.processing(true))
      await page.waitForFunction(() => document.querySelectorAll('[data-run-running]').length === 1)
      const strip = await page.locator('[data-run-running]').innerText()
      assert.match(strip, /Request #13 is waiting/)
      assert.match(await page.locator('[data-run-state]').innerText(), /Running/)
      await shot(page, 'running-state')
      await page.evaluate(() => (window as unknown as { runRedesignFixture: { processing(value: boolean): void } }).runRedesignFixture.processing(false))
      await page.waitForFunction(() => document.querySelectorAll('[data-run-running]').length === 0)
      return strip.replace(/\s+/g, ' ')
    })

    await check('R20b a 300-request run keeps every chart and list bounded', async () => {
      await page.evaluate(() => (window as unknown as { runRedesignFixture: { select(id: string): void } }).runRedesignFixture.select('run-long'))
      await page.waitForFunction(() => document.querySelectorAll('[data-run-context-trend] [data-trend-bar]').length > 0, undefined, { timeout: 30_000 })
      // 300 requests exceed the 72-bar budget; the chart keeps peaks and both ends.
      const bars = await page.locator('[data-run-context-trend] [data-trend-bar]').count()
      assert(bars > 0 && bars <= 72, `trend chart kept ${bars} bars`)
      assert.match(await page.locator('[data-run-scope]').innerText(), /requests: 300/)
      const performance = await page.locator('[data-run-performance]').innerText()
      assert.match(performance, /valid samples: \d+\/300/)
      await tab(page, 'Context')
      await page.waitForFunction(() => document.querySelectorAll('select[aria-label="Select model request"] option').length === 300, undefined, { timeout: 30_000 })
      assert.match(await page.locator('[data-run-context-browser]').innerText(), /estimate/)
      const userGroup = page.locator('[data-context-category="user"]')
      await userGroup.locator('> summary').click()
      await userGroup.locator('[data-context-item]').nth(49).waitFor()
      assert.equal(await userGroup.locator('[data-context-item]').count(), 50)
      const more = userGroup.getByRole('button', { name: 'Load more', exact: true })
      assert.equal(await more.count(), 1, 'older retained entries must remain accessible')
      await more.click()
      await userGroup.locator('[data-context-item]').nth(99).waitFor()
      assert.equal(await userGroup.locator('[data-context-item]').count(), 100)
      assert.equal(await userGroup.locator('[class*="readerContent"]').count(), 0, 'loading rows does not mount their content')
      const marker = page.locator('[data-run-context-history] [class*="eventMarker"]')
      assert.equal(await marker.count(), 1, 'bucketed total chart retains a compaction marker')
      await page.getByRole('button', { name: 'Net change', exact: true }).click()
      const drop = page.locator('[data-run-context-history] [data-trend-bar="151"]')
      assert.match(await drop.getAttribute('aria-label') ?? '', /−16K/)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await shot(page, 'long-history-light')
      await page.evaluate(() => (window as unknown as { runRedesignFixture: { select(id: string): void } }).runRedesignFixture.select('run-main'))
      await tab(page, 'Overview')
      await page.waitForFunction(() => document.querySelector('[data-run-metric]'))
      return { bars }
    })

    await check('A03 Context compares actual content and exposes all retained text', async () => {
      await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.select('run-review'))
      try {
        await tab(page, 'Context')
        const picker = page.locator('select[aria-label="Select model request"]')
        await picker.selectOption('2')
        const system = page.locator('[data-context-category="system"]')
        await system.locator('> summary').click()
        const browser = page.locator('[data-run-context-browser]')
        await system.getByRole('heading', { name: 'System bbb', exact: true }).waitFor()
        await browser.getByRole('button', { name: 'Changes', exact: true }).click()
        assert.match(await system.innerText(), /Content changed: 12 → 12/)
        assert.match(await system.locator('[data-change-before]').innerText(), /# System aaa/)
        assert.match(await system.locator('[data-change-after]').innerText(), /# System bbb/)
        await shot(page, 'context-prompt-changes')
        await picker.selectOption('3')
        assert.match(await system.innerText(), /No content changes/)
        const schemas = page.locator('[data-context-category="schemas"]')
        await schemas.locator('> summary').click()
        const removed = schemas.locator('[data-context-item][data-change="removed"]')
        await removed.waitFor()
        assert.match(await removed.innerText(), /edit/)
        await browser.getByRole('button', { name: 'Original', exact: true }).click()
        const user = page.locator('[data-context-category="user"]')
        await user.locator('> summary').click()
        await user.locator('[data-context-item="user:review-u1"] [data-context-row]').click({ timeout: 2000 })
        assert.match(await user.locator('[data-context-item="user:review-u1"]').innerText(), /Retained paragraph 15\./)
        const long = user.locator('[data-context-item="user:review-u2"]')
        await long.locator('[data-context-row]').click()
        await long.getByRole('button', { name: 'Show full content', exact: true }).click()
        assert.match(await long.innerText(), /END OF RETAINED CONTENT/)
        // Permission denial is a recoverable read state, never a success badge.
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
        await long.getByRole('button', { name: 'Copy content', exact: true }).click()
        assert.match(await long.getByRole('status').innerText(), /Copy failed/)
        assert.equal(await long.getByRole('button', { name: 'Copied', exact: true }).count(), 0)
        assert.equal(await user.locator('details details').count(), 0)
        assert(await user.locator('[class*="readerContent"]').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).overflowY !== 'auto')))
        await shot(page, 'context-selected-full-content')
        await picker.selectOption('1')
        assert(await browser.getByRole('button', { name: 'Changes', exact: true }).isDisabled())
      } finally {
        await page.evaluate(() => (window as unknown as ReviewWindow).runRedesignFixture.select('run-main'))
        await tab(page, 'Overview')
      }
    })

    await check('R21 an empty session invents no numbers and keeps five tabs', async () => {
      await page.evaluate(() => (window as unknown as { runRedesignFixture: { select(id: string): void } }).runRedesignFixture.select('run-empty'))
      try {
        await page.waitForFunction(() => document.querySelector('[data-run-empty="empty"]'))
      } catch (error) {
        const state = await page.evaluate(() => ({
          empty: document.querySelector('[data-run-empty]')?.getAttribute('data-run-empty') ?? null,
          text: document.body.innerText.slice(0, 400),
        }))
        throw new Error(`${error instanceof Error ? error.message : String(error)} | state: ${JSON.stringify(state)}`)
      }
      const text = await page.locator('[data-run-empty="empty"]').innerText()
      assert.match(text, /This session has no run records yet/)
      assert.equal(await page.getByRole('tab').count(), 5)
      await shot(page, 'empty-session')
      await page.evaluate(() => (window as unknown as { runRedesignFixture: { select(id: string): void } }).runRedesignFixture.select('run-main'))
      await page.waitForFunction(() => document.querySelector('[data-run-metric]'))
      return text.replace(/\s+/g, ' ')
    })

    await check('R22 the 600px panel stacks to one reading column without overflow', async () => {
      await page.setViewportSize({ width: 600, height: 1000 })
      await settle(page)
      await tab(page, 'Overview')
      const columns = await page.locator('[data-run-view] [class*="overviewGrid"]').first().evaluate(node => getComputedStyle(node).gridTemplateColumns)
      assert.equal(columns.trim().split(/\s+/).length, 1, `overview grid should stack: ${columns}`)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await shot(page, 'panel-overview-light')
      await tab(page, 'Context')
      await page.locator('select[aria-label="Select model request"]').selectOption('12')
      await page.locator('[data-context-category="tool"] > summary').click()
      await page.waitForFunction(() => document.querySelector('[data-context-category="tool"]')?.hasAttribute('open'))
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.locator('[data-context-item="tool:t8"] [data-context-row]').click()
      await page.locator('[data-context-item="tool:t8"] [data-context-result]').waitFor()
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await shot(page, 'panel-context-light')
      await tab(page, 'Decision')
      await page.locator('[data-decision-id="dec_006"] button').first().click()
      await page.waitForFunction(() => document.querySelector('[data-decision-id="dec_006"] [role="region"]'))
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await shot(page, 'panel-decision-light')
      await page.setViewportSize({ width: 320, height: 1000 })
      await settle(page)
      const compact = page.locator('[data-run-toolbar]')
      assert(await page.locator('[data-run-state]').isVisible())
      assert(!(await page.locator('[data-run-scope]').isVisible()))
      assert(await compact.evaluate(node => node.getBoundingClientRect().height <= 42))
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.getByRole('tab', { name: 'Map', exact: true }).focus()
      await page.keyboard.press('Home')
      assert.equal(await page.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'), 'true')
      await page.waitForFunction(() => {
        const selected = document.querySelector('[role="tab"][aria-selected="true"]')!
        const tab = selected.getBoundingClientRect(), strip = selected.parentElement!.getBoundingClientRect()
        return tab.left >= strip.left - 1 && tab.right <= strip.right + 1
      }, undefined, { timeout: 3000 })
      await shot(page, 'compact-toolbar-320')
      await page.setViewportSize({ width: 600, height: 1000 })
      return { columns }
    })

    /* ── dark, 390px, Chinese ─────────────────────────────────────────── */
    const darkContext = await launched.browser.newContext({ viewport: { width: 390, height: 1000 }, colorScheme: 'dark', deviceScaleFactor: 1, locale: 'zh-CN', reducedMotion: 'reduce' })
    const dark = await darkContext.newPage()
    dark.on('pageerror', error => { if (!noise(error.message)) errors.push(`dark: ${error.message}`) })
    dark.on('console', message => { if (message.type() === 'error' && !noise(message.text())) errors.push(`dark: ${message.text()}`) })
    await gotoWithRetry(dark, `${url}&mode=dark&lang=zh-Hans`)
    await dark.waitForFunction(() => (window as unknown as { runRedesignFixture?: { ready: boolean } }).runRedesignFixture?.ready === true, undefined, { timeout: 60_000 })
    await dark.locator('[data-run-state]').waitFor()
    await dark.evaluate(() => document.fonts.ready)
    await settle(dark)

    await check('R23 dark 390px renders every view without horizontal overflow', async () => {
      assert.deepEqual(await paletteOf(dark), expectedPalette(prototypeDark))
      const labels = await dark.getByRole('tab').allInnerTexts()
      assert.equal(labels.length, 5)
      assert.equal(labels[0]?.trim(), '概览')
      assert.equal(labels[2]?.trim(), '决策')
      await dark.screenshot({ path: join(run.directory, 'dark-overview-390.png'), fullPage: true, animations: 'disabled' })
      sceneShots.push('dark-overview-390.png')
      assert.match(await dark.locator('[data-run-state]').innerText(), /已完成/)
      for (const [name, scene] of [['上下文', 'dark-context-390'], ['决策', 'dark-decision-390']] as const) {
        await dark.getByRole('tab', { name, exact: true }).click()
        if (name === '上下文') {
          await dark.locator('[data-context-category="tool"] > summary').click()
          await dark.locator('[data-context-item="tool:t8"] [data-context-row]').click()
          await dark.locator('[data-context-item="tool:t8"] [data-context-result]').waitFor()
        }
        await settle(dark)
        assert(await dark.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflows at 390px`)
        await dark.screenshot({ path: join(run.directory, `${scene}.png`), fullPage: true, animations: 'disabled' })
        sceneShots.push(`${scene}.png`)
      }
      return 'zh-Hans dark verified'
    })

    /* ── failed session ───────────────────────────────────────────────── */
    await check('A11 trajectory preserves category identities and readable badges in dark mode', async () => {
      await tab(dark, '轨迹')
      await dark.getByRole('button', { name: '展开调用', exact: true }).click()
      await visiblePanel(dark).locator('[data-role-kind="tool"]').first().waitFor()
      const colors = await trajectoryPalette(dark)
      assert.deepEqual(colors.spans, { user: [34, 197, 94], system: [99, 102, 241], message: [59, 130, 246], tool: [20, 184, 166] })
      assert.deepEqual(colors.ink, [238, 240, 246])
      assert.deepEqual(colors.surface, [30, 34, 43])
      for (const badge of colors.badges) assert(badge.contrast >= 4.5, `${badge.kind} dark contrast ${badge.contrast}`)
      assert(await dark.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await shot(dark, 'trajectory-dark-palette-390')
      return colors
    })

    const failContext = await launched.browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: 'light' })
    const failed = await failContext.newPage()
    failed.on('pageerror', error => { if (!noise(error.message)) errors.push(`failed: ${error.message}`) })
    await gotoWithRetry(failed, `${url}&fail=1`)
    await failed.waitForFunction(() => (window as unknown as { runRedesignFixture?: { ready: boolean } }).runRedesignFixture?.ready === true, undefined, { timeout: 60_000 })
    await failed.locator('[data-run-state]').waitFor()
    await check('R24 a failed load reports unavailable records and offers a reload', async () => {
      await failed.evaluate(() => (window as unknown as { runRedesignFixture: { select(id: string): void } }).runRedesignFixture.select('run-error'))
      await failed.waitForFunction(() => document.querySelector('[data-run-empty="error"]'), undefined, { timeout: 20_000 })
      const text = await failed.locator('[data-run-empty="error"]').innerText()
      assert.match(text, /Run records could not be loaded/)
      assert.match(text, /Reload/)
      assert.match(await failed.locator('[data-run-state]').innerText(), /Records unavailable/)
      await failed.screenshot({ path: join(run.directory, 'failed-session.png'), fullPage: true, animations: 'disabled' })
      sceneShots.push('failed-session.png')
      return text.replace(/\s+/g, ' ')
    })

    await check('R25 no browser execution errors', async () => assert.deepEqual(errors, []))

    const measurements = await page.evaluate(() => {
      const rect = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) return null
        const box = node.getBoundingClientRect()
        return { width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.top) }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight },
        toolbar: rect('[data-run-toolbar]'),
        tabs: rect('[class*="runTabs"]'),
        content: rect('[data-run-view]'),
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
    run.json('measurements.json', measurements)

    await wideContext.close()
    await darkContext.close()
    await failContext.close()

    await check('R26 evidence files are complete', async () => {
      assert(checks.every(entry => entry.passed))
      return { screenshots: sceneShots.length }
    })
    run.json('checks.json', { generatedAt: new Date().toISOString(), checks, errors, screenshots: sceneShots })

    const passed = checks.filter(entry => entry.passed).map(entry => entry.id)
    run.complete(passed, [
      'Live provider streams and real session data (the fixture supplies recorded-shaped evidence)',
      'Electron IPC and the workbench host chrome around the panel',
      'The Trajectory ledger and Map views (unchanged by this redesign; only their tab frame is asserted)',
      'Successful writes to the operating-system clipboard (permission denial is verified)',
    ])
    assert(checks.every(entry => entry.passed), JSON.stringify(checks.filter(entry => !entry.passed), null, 2))
  } finally {
    await launched.close()
    await server.close()
  }
})

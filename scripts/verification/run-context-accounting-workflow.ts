/** Run's real panel: consistent accounting, distinct categories, optional local session replay. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { Message } from '@phaneris/core/types'
import { readSessionJsonl } from '../../packages/shared/src/sessions/jsonl'
import { buildFixturePage } from './fixture-bundle'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

type FixtureWindow = { runRedesignFixture: { ready: boolean; evidence(id: string, messages: Message[], window?: number, usage?: unknown): void } }
const categories = ['system', 'schemas', 'user', 'inject', 'skill', 'assistant', 'tool']
// User-approved A / 清透原色, taken from the reviewed HTML (not the product CSS).
const approvedPalette = {
  light: ['rgb(149, 104, 227)', 'rgb(221, 161, 41)', 'rgb(99, 179, 117)', 'rgb(143, 158, 183)', 'rgb(228, 121, 171)', 'rgb(76, 150, 224)', 'rgb(40, 178, 164)'],
  dark: ['rgb(185, 154, 239)', 'rgb(236, 193, 106)', 'rgb(138, 212, 152)', 'rgb(174, 187, 209)', 'rgb(240, 161, 202)', 'rgb(130, 184, 239)', 'rgb(101, 213, 198)'],
}
const usage = (input: number) => ({ input: 196, cacheRead: input - 196, cacheWrite: 0, output: 433,
  totalTokens: input + 433, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
const evidence: Message[] = [
  { id: 'u', role: 'user', content: 'Inspect the recorded request.', timestamp: 1 },
  { id: 'i', role: 'info', content: 'Recorded injected context', timestamp: 2 },
  { id: 'a1', role: 'assistant', content: 'Read the skill and the result.', timestamp: 3, requestSeq: 1, usage: usage(180_000) },
  { id: 's', role: 'tool', content: '# Skill content', toolInput: { path: 'C:/skills/example/SKILL.md' }, toolName: 'read', toolUseId: 's', toolStatus: 'completed', timestamp: 4 },
  { id: 't', role: 'tool', content: 'Retained preview of the model result', toolName: 'shell', toolUseId: 't', toolStatus: 'completed', timestamp: 5 },
  { id: 'a2', role: 'assistant', content: 'Done', timestamp: 6, requestSeq: 2, promptSnapshot: 'System prompt', usage: usage(184_900),
    contextSnapshot: { version: 1, capturedAt: 5, provider: 'custom-endpoint', model: 'deepseek-flash',
      system: { hash: 'system', chars: 29_728 }, tools: [{ name: 'read', hash: 'read', schemaChars: 43_600 }],
      messages: [{ role: 'user', hash: 'u', chars: 19_281 }, { role: 'assistant', hash: 'a', chars: 255_422 },
        { role: 'toolResult', hash: 'tool', chars: 11_282_329 }] } },
]
const active = (page: Page) => page.locator('[role="tabpanel"]:not([hidden])')
const tab = async (page: Page, name: string) => { await page.getByRole('tab', { name, exact: true }).click() }
const mount = async (page: Page, id: string, messages: Message[], tokenUsage?: unknown) => {
  await page.evaluate(({ id, messages, tokenUsage }) => (window as unknown as FixtureWindow).runRedesignFixture.evidence(id, messages, undefined, tokenUsage), { id, messages, tokenUsage })
  await page.locator('[data-run-scope]').filter({ hasText: `requests: ${messages.filter(m => m.role === 'assistant' && m.requestSeq !== undefined).length}` }).waitFor({ state: 'attached' })
}
const amounts = (page: Page, selector: string) => active(page).locator(selector).evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-context-tokens'))))

await verificationWorkflow('run-context-accounting', async run => {
  const server = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/run-redesign.tsx' })
  const launched = await launchWorkflowBrowser()
  const checks: Array<{ id: string; detail: unknown }> = []
  const screenshots: string[] = []
  const errors: string[] = []
  const check = async (id: string, fn: () => Promise<unknown>) => { const detail = await fn(); checks.push({ id, detail }); console.log(`PASS ${id}`) }
  const shot = async (page: Page, name: string) => {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => {
      const active = document.querySelector('[role="tab"][aria-selected="true"]')
      const underline = active?.querySelector('span[aria-hidden="true"]')
      if (!active || !underline) return true
      const target = active.getBoundingClientRect(), line = underline.getBoundingClientRect()
      return Math.abs(line.left - target.left) < 1 && Math.abs(line.width - target.width) < 1
    }, undefined, { timeout: 3000 })
    await page.screenshot({ path: join(run.directory, `${name}.png`), animations: 'disabled' })
    screenshots.push(`${name}.png`)
  }
  try {
    for (const mode of ['light', 'dark'] as const) {
      const page = await launched.browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: mode, reducedMotion: 'reduce' })
      page.on('pageerror', error => errors.push(error.message))
      await gotoWithRetry(page, `${server.url}?mode=${mode}`)
      await page.waitForFunction(() => (window as unknown as FixtureWindow).runRedesignFixture?.ready)
      await page.locator('[data-run-state]').waitFor()
      await mount(page, `accounting-${mode}`, evidence)
      await tab(page, 'Context')
      await check(`${mode}: provider input owns total and category sum`, async () => {
        const tokens = await amounts(page, '[data-context-category]')
        assert.equal(tokens.length, 7)
        assert.equal(tokens.reduce((a, b) => a + b, 0), 184_900)
        assert(tokens.every(value => Number.isInteger(value) && value >= 0))
        assert.equal(await active(page).locator('[data-context-total]').getAttribute('data-context-total'), '184900')
        assert.match(await active(page).locator('[data-run-context-history]').innerText(), /184\.9K tokens/)
        assert.match(await active(page).locator('[data-run-context-browser]').innerText(), /input 184,900/)
        assert.match(await active(page).locator('[data-run-cache-hit]').innerText(), /Cache hit 99\.9%/)
        assert.doesNotMatch(await active(page).locator('[data-run-context-browser]').innerText(), /2\.9M/)
        await tab(page, 'Overview')
        assert.deepEqual(await amounts(page, '[data-category-legend]'), tokens)
        assert.equal(await active(page).locator('[data-run-occupancy]').getAttribute('data-context-total'), '184900')
        assert.match(await active(page).locator('[data-run-context-trend]').innerText(), /184\.9K tokens/)
        assert.match(await active(page).locator('[data-run-cache-hit]').innerText(), /Cache hit 99\.9%/)
        await shot(page, `accounting-overview-${mode}`)
        await tab(page, 'Context')
        await active(page).getByRole('button', { name: 'Net change', exact: true }).click()
        assert.match(await active(page).locator('[data-trend-bar="2"]').getAttribute('aria-label') ?? '', /\+4\.9K/)
        await active(page).getByRole('button', { name: 'Cumulative composition', exact: true }).click()
        await shot(page, `accounting-context-${mode}`)
        return { tokens, sum: 184_900 }
      })
      await check(`${mode}: approved palette shared across all views with readable badges`, async () => {
        const contextColors = await active(page).locator('[data-context-category] [class*="categoryDot"]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
        assert.equal(new Set(contextColors).size, 7)
        await tab(page, 'Overview')
        const overviewColors = await active(page).locator('[data-category-legend] [class*="categoryDot"]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
        assert.deepEqual(overviewColors, contextColors)
        await tab(page, 'Trajectory')
        await active(page).getByRole('button', { name: 'Expand calls', exact: true }).click()
        const result = await active(page).evaluate((node, categories) => {
          const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
          const rgb = (color: string) => {
            context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1)
            return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
          }
          const lum = (color: number[]) => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0)
          const contrast = (a: string, b: string) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
          const rootStyle = getComputedStyle(node)
          const surface = getComputedStyle(node.querySelector('table')!).backgroundColor
          const probe = document.createElement('i'); probe.style.transition = 'none'; node.append(probe)
          const colors = categories.map(category => { probe.style.backgroundColor = `var(--run-cat-${category})`; return getComputedStyle(probe).backgroundColor })
          probe.remove()
          const marks = colors.map(color => contrast(color, surface))
          const hue = (color: string) => {
            const [r, g, b] = rgb(color).map(v => v / 255), max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!), d = max - min
            return d === 0 ? 0 : ((max === r ? (g! - b!) / d : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4) * 60 + 360) % 360
          }
          const badges = [...node.querySelectorAll('[data-role-kind]')].map(badge => { const style = getComputedStyle(badge); return { kind: badge.getAttribute('data-role-kind'), contrast: contrast(style.color, style.backgroundColor) } })
          const spans = Object.fromEntries(['user', 'system', 'message', 'tool'].map(kind => [kind, getComputedStyle(node.querySelector(`[data-kind="${kind}"]`)!).backgroundColor]))
          return { colors, marks, badges, spans, hues: colors.map(hue), ink: rootStyle.color }
        }, categories)
        assert.deepEqual(result.colors, contextColors)
        assert.deepEqual(result.colors, approvedPalette[mode])
        assert.deepEqual(result.spans, { user: contextColors[2], system: contextColors[0], message: contextColors[5], tool: contextColors[6] })
        // Preserve the approved categorical fills exactly. Category names and
        // positions identify the data; badge text must still meet AA contrast.
        assert(result.badges.every(badge => badge.contrast >= 4.5), JSON.stringify(result.badges))
        const hueGap = Math.abs(result.hues[1]! - result.hues[4]!)
        assert(Math.min(hueGap, 360 - hueGap) >= 60, 'definitions and skills need distinct hues')
        const systemGap = Math.abs(result.hues[0]! - result.hues[5]!)
        assert(Math.min(systemGap, 360 - systemGap) >= 50, 'system and assistant need distinct hues')
        await shot(page, `accounting-trajectory-${mode}`)
        return result
      })
      await page.close()
    }
    const page = await launched.browser.newPage({ viewport: { width: 1200, height: 950 }, reducedMotion: 'reduce' })
    await gotoWithRetry(page, server.url)
    await page.locator('[data-run-state]').waitFor()
    await check('short histories use evenly spaced columns no wider than 32px', async () => {
      const measurements = []
      for (const count of [1, 3, 5, 12]) {
        const messages = Array.from({ length: count }, (_, index) => ({
          ...evidence.at(-1)!, id: `short-${count}-${index}`, timestamp: index + 1, requestSeq: index + 1,
          usage: usage(20_000 + index * 4_000),
        }))
        await mount(page, `short-${count}`, messages)
        for (const width of [1440, 600, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          for (const view of ['Overview', 'Context']) {
            await tab(page, view)
            const chart = active(page).locator('[class*="trendChart"]')
            const geometry = await chart.evaluate(node => {
              const columns = [...node.querySelectorAll('[data-trend-bar]')].map(column => {
                const slot = column.getBoundingClientRect(), bar = column.querySelector('[class*="barStack"]')!.getBoundingClientRect()
                const selected = column.getAttribute('aria-pressed') === 'true'
                return { center: (slot.left + slot.right) / 2, barCenter: (bar.left + bar.right) / 2, slotWidth: slot.width, barWidth: bar.width, selected,
                  outline: getComputedStyle(column.querySelector('[class*="barStack"]')!).outlineStyle }
              })
              const labels = [...node.querySelectorAll('[data-trend-axis] span')].map(label => ({ text: label.textContent, left: label.getBoundingClientRect().left, right: label.getBoundingClientRect().right }))
              return { columns, labels }
            })
            assert.equal(geometry.columns.length, count)
            for (const column of geometry.columns) {
              assert(column.barWidth <= 32.1 && column.barWidth <= column.slotWidth + 0.1, JSON.stringify(geometry))
              assert(Math.abs(column.barCenter - column.center) < 0.6)
              if (column.selected) assert.equal(column.outline, 'solid')
            }
            const spacing = geometry.columns.slice(1).map((column, index) => column.center - geometry.columns[index]!.center)
            if (spacing.length) assert(Math.max(...spacing) - Math.min(...spacing) < 0.6)
            for (let index = 1; index < geometry.labels.length; index++) assert(geometry.labels[index]!.left > geometry.labels[index - 1]!.right)
            measurements.push({ count, width, view, ...geometry })
            if (count === 5 && width !== 600) await shot(page, `short-five-${view.toLowerCase()}-${width}`)
            await chart.locator('[data-trend-bar]').first().click()
            assert.equal(await chart.locator('[data-trend-bar]').first().getAttribute('aria-pressed'), 'true')
            if (view === 'Context') {
              await active(page).getByRole('button', { name: 'Net change', exact: true }).click()
              const deltaWidths = await chart.locator('[class*="deltaBar"]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))
              assert(deltaWidths.every(value => value <= 32.1))
              await active(page).getByRole('button', { name: 'Cumulative composition', exact: true }).click()
            }
          }
        }
      }
      await page.setViewportSize({ width: 1200, height: 950 })
      return measurements
    })
    await check('long-history x axis stays in one row below both plots', async () => {
      await page.evaluate(() => (window as unknown as { runRedesignFixture: { select(id: string): void } }).runRedesignFixture.select('run-long'))
      const measurements = []
      for (const width of [1440, 600, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const name of ['Overview', 'Context']) {
          await tab(page, name)
          const geometry = await active(page).locator('[class*="trendChart"]').evaluate(chart => {
            const plotBottom = chart.querySelector('[class*="gridLines"]')!.getBoundingClientRect().bottom
            const ticks = [...chart.querySelectorAll('[data-trend-axis] span')].map(node => {
              const rect = node.getBoundingClientRect()
              return { text: node.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, lineHeight: parseFloat(getComputedStyle(node).lineHeight) }
            })
            return { plotBottom, ticks }
          })
          assert(geometry.ticks.length >= 2 && geometry.ticks.length <= 9)
          const tops = geometry.ticks.map(tick => tick.top)
          assert(Math.max(...tops) - Math.min(...tops) < 1)
          for (let index = 0; index < geometry.ticks.length; index++) {
            const tick = geometry.ticks[index]!
            assert(tick.top >= geometry.plotBottom, JSON.stringify(geometry))
            assert(tick.height <= tick.lineHeight + 1)
            if (index > 0) assert(tick.left > geometry.ticks[index - 1]!.right)
          }
          assert.equal(geometry.ticks[0]!.text, '1')
          assert.equal(geometry.ticks.at(-1)!.text, '300')
          measurements.push({ width, view: name, ...geometry })
          if (width !== 600) await shot(page, `axis-${name.toLowerCase()}-${width}`)
        }
      }
      await page.setViewportSize({ width: 1200, height: 950 })
      return measurements
    })
    await check('cache rate follows selected request, counts writes as misses and shows zero hits', async () => {
      const variants = [
        { ...evidence.at(-1)!, id: 'cache-write', requestSeq: 1, usage: { ...usage(1000), input: 300, cacheRead: 500, cacheWrite: 200 } },
        { ...evidence.at(-1)!, id: 'cache-miss', requestSeq: 2, usage: { ...usage(1000), input: 1000, cacheRead: 0 } },
      ]
      await mount(page, 'cache-variants', variants)
      await tab(page, 'Context')
      assert.match(await active(page).locator('[data-run-cache-hit]').innerText(), /Cache hit 0\.0%/)
      await active(page).getByRole('combobox', { name: 'Select model request' }).selectOption('1')
      assert.match(await active(page).locator('[data-run-cache-hit]').innerText(), /Cache hit 50\.0%/)
      await tab(page, 'Overview')
      await active(page).locator('[data-trend-bar="1"]').click()
      assert.match(await active(page).locator('[data-run-cache-hit]').innerText(), /Cache hit 50\.0%/)
      return { denominator: 'input + cacheRead + cacheWrite', first: '50.0%', last: '0.0%' }
    })
    await check('missing metering stays an estimate; zero metering stays zero', async () => {
      const missing = evidence.map(({ usage: _usage, ...message }) => message)
      await mount(page, 'missing-input', missing)
      await tab(page, 'Context')
      const sum = (await amounts(page, '[data-context-category]')).reduce((a, b) => a + b, 0)
      assert(sum > 2_000_000)
      assert.match(await active(page).locator('[data-run-context-history]').innerText(), /≈.*tokens[\s\S]*Provider input not recorded/)
      assert.match(await active(page).locator('[data-run-cache-hit]').innerText(), /Cache hit —/)
      await tab(page, 'Overview')
      assert.match(await active(page).locator('[data-run-occupancy]').innerText(), /≈/)
      assert.match(await active(page).locator('[data-run-occupancy]').innerText(), /Provider input not recorded/)
      const zero = evidence.map(message => message.usage ? { ...message, usage: { ...usage(196), input: 0, cacheRead: 0 } } : message)
      await mount(page, 'zero-input', zero)
      await tab(page, 'Context')
      assert.equal((await amounts(page, '[data-context-category]')).reduce((a, b) => a + b, 0), 0)
      assert.equal(await active(page).locator('[data-context-total]').getAttribute('data-context-total'), '0')
      assert.match(await active(page).locator('[data-run-cache-hit]').innerText(), /Cache hit —/)
      return { fallbackEstimate: sum, zero: 0 }
    })
    const localPath = process.env.PHANERIS_RUN_CONTEXT_SESSION
    if (localPath) await check('real persisted session replays with matching totals', async () => {
      const stored = readSessionJsonl(localPath)
      assert(stored)
      const messages = stored.messages.map(message => ({ ...message, role: message.type })) as Message[]
      const latest = [...messages].reverse().find(message => message.role === 'assistant' && message.requestSeq !== undefined)!
      const expected = latest.usage!.input + latest.usage!.cacheRead + latest.usage!.cacheWrite
      await mount(page, 'local-session', messages, stored.tokenUsage)
      await tab(page, 'Context')
      await active(page).locator('[data-context-total]').waitFor()
      const tokens = await amounts(page, '[data-context-category]')
      assert.equal(tokens.reduce((a, b) => a + b, 0), expected)
      assert.equal(await active(page).locator('[data-context-total]').getAttribute('data-context-total'), String(expected))
      await shot(page, 'real-session-context')
      await tab(page, 'Overview')
      assert.equal(await active(page).locator('[data-run-occupancy]').getAttribute('data-context-total'), String(expected))
      assert.deepEqual(await amounts(page, '[data-category-legend]'), tokens)
      await shot(page, 'real-session-overview')
      return { requests: messages.filter(message => message.role === 'assistant' && message.requestSeq !== undefined).length, input: expected, categoryTokens: tokens }
    })
    assert.deepEqual(errors, [])
    run.json('checks.json', { checks, errors, screenshots })
    run.complete(checks.map(check => check.id), ['Live provider calls', 'Installed Electron renderer (browser mounts production components)'])
    await page.close()
  } finally { await launched.close(); await server.close() }
})

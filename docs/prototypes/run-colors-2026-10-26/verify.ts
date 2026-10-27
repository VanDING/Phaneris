/** Repeatable browser evidence for the review artifact; does not modify product code. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from '../../../scripts/verification/verification-artifacts'
import { launchWorkflowBrowser } from '../../../scripts/verification/workflow-browser'

await verificationWorkflow('run-design-review', async run => {
  const url = process.env.PHANERIS_DESIGN_REVIEW_URL
  assert(url, 'Set PHANERIS_DESIGN_REVIEW_URL to the local serve.ts URL')
  const launched = await launchWorkflowBrowser()
  const checks: string[] = [], errors: string[] = []
  const page = await launched.browser.newPage({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  const screenshots: string[] = []
  const shot = async (name: string) => { await page.screenshot({ path: join(run.directory, `${name}.png`), fullPage: true }); screenshots.push(`${name}.png`) }
  try {
    await page.goto(url)
    await page.locator('.palette-option').first().waitFor()
    assert.equal(await page.locator('.palette-option').count(), 4)
    for (const palette of ['a', 'b', 'c', 'original']) {
      await page.locator(`[data-palette="${palette}"]`).click()
      for (const mode of ['light', 'dark']) {
        await page.locator('#mode').selectOption(mode)
        for (const view of ['overview', 'context', 'trajectory']) {
          await page.locator(`[data-view="${view}"]`).click()
          assert.equal(await page.locator(`[data-palette="${palette}"]`).getAttribute('aria-pressed'), 'true')
          assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('aria-selected'), 'true')
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          const colors = await page.locator('.category-reference i').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
          assert.equal(new Set(colors).size, 7)
          checks.push(`${palette}-${mode}-${view}`)
          if (view === 'overview' || palette === 'a' && view === 'trajectory') await shot(`${palette}-${mode}-${view}`)
        }
      }
    }
    await page.locator('[data-view="overview"]').click()
    await page.locator('[data-palette="a"]').click()
    await page.locator('#mode').selectOption('light')
    for (const width of ['wide', 'panel']) {
      await page.locator('#width').selectOption(width)
      for (const count of [3, 5, 12, 113, 300]) {
        await page.locator('#count').selectOption(String(count))
        for (const layout of ['spaced', 'compact', 'fill']) {
          await page.locator('#layout').selectOption(layout)
          const geometry = await page.locator('.trend').evaluate(node => {
            const columns = [...node.querySelectorAll('.column')].map(column => ({ slot: column.getBoundingClientRect().width, bar: column.querySelector('.bar')!.getBoundingClientRect().width, right: column.getBoundingClientRect().right }))
            const labels = [...node.querySelectorAll('.axis>span')].map(label => ({ top: label.getBoundingClientRect().top, bottom: label.getBoundingClientRect().bottom }))
            return { columns, labels, plotBottom: node.querySelector('.gridlines')!.getBoundingClientRect().bottom, plotRight: node.querySelector('.plot')!.getBoundingClientRect().right }
          })
          assert.equal(geometry.columns.length, Math.min(count, 72))
          if (count <= 12 && layout !== 'fill') assert(geometry.columns.every(column => column.bar <= 32.1))
          assert(geometry.columns.every(column => column.right <= geometry.plotRight + 1))
          assert(geometry.labels.every(label => label.top >= geometry.plotBottom))
          assert(Math.max(...geometry.labels.map(label => label.top)) - Math.min(...geometry.labels.map(label => label.top)) < 1)
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          checks.push(`${width}-${count}-${layout}`)
          if (width === 'wide' && count === 5) await shot(`five-requests-${layout}`)
        }
      }
    }
    await page.locator('#width').selectOption('wide')
    await page.locator('#count').selectOption('5')
    await page.locator('#layout').selectOption('spaced')
    await page.locator('#compare').click()
    assert.equal(await page.locator('[data-palette="original"]').getAttribute('aria-pressed'), 'true')
    await page.locator('#compare').click()
    assert.equal(await page.locator('[data-palette="a"]').getAttribute('aria-pressed'), 'true')
    await page.locator('.column').nth(1).click()
    assert.match(await page.locator('.selection').innerText(), /Request #2/)
    await page.locator('[data-view="context"]').click()
    await page.locator('.request-picker').selectOption('3')
    assert.match(await page.locator('.request-line').innerText(), /Request #3/)
    await page.locator('.folds summary').first().click()
    assert(await page.locator('.folds details').first().getAttribute('open') !== null)
    checks.push('comparison-and-request-interactions')
    await page.setViewportSize({ width: 480, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await shot('mobile-context')
    checks.push('mobile-no-horizontal-overflow')
    assert.deepEqual(errors, [])
    run.json('checks.json', { checks, errors, screenshots })
    run.complete(checks, ['Final product palette and short-history implementation: awaiting user selection'])
  } finally { await launched.close() }
})

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('preview-copy', async run => {
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage(), errors: string[] = [], checks: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let fixture: Awaited<ReturnType<typeof buildFixturePage>> | undefined
  try {
    fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/preview-copy.tsx' })
    await gotoWithRetry(page, fixture.url)
    const expected = await page.evaluate(() => window.previewCopyExpected)
    for (const id of ['html', 'pdf', 'image', 'mermaid', 'legacy']) {
      if (id !== 'legacy') { await page.getByTestId('open-' + id).click(); await page.getByRole('dialog').waitFor() }
      if (id === 'pdf') await page.locator('.react-pdf__Page__canvas').waitFor({ state: 'visible', timeout: 30_000 })
      const scope = id === 'legacy' ? page.getByTestId('legacy') : page.getByRole('dialog')
      const button = scope.getByTitle(expected[id]!.title, { exact: true }); await button.click()
      assert.equal(await page.evaluate(() => window.previewCopies.at(-1)), expected[id]!.content)
      await scope.getByTitle('Copied!', { exact: true }).waitFor()
      await button.waitFor({ timeout: 5000 })
      checks.push(id + '-title-content-feedback-and-reset')
      if (id !== 'legacy') { await page.screenshot({ path: join(run.directory, id + '.png') }); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }) }
    }
    run.json('scenarios.json', { checks, errors, expected, copied: await page.evaluate(() => window.previewCopies) }); assert.deepEqual(errors, [])
    run.complete(checks, ['Clipboard API is recorded in browser memory to preserve the user clipboard; native OS clipboard integration is not claimed.', 'PDF rendering uses the real pdf.js worker and a synthetic one-page PDF.'])
  } finally {
    run.json('last-state.json', { checks, errors, text: await page.locator('body').innerText().catch(() => '') })
    await context.close(); await launched.close(); await fixture?.close()
  }
})

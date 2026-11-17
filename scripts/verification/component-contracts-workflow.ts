#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser, gotoWithRetry } from './workflow-browser'

// Before signature cleanup: real parent OAuth actions, trimmed code, disabled
// validation and errors survive; entity order/text, two-part model selection,
// unavailable state, and nested activity indentation/expansion stay unchanged.
await verificationWorkflow('component-contracts', async run => {
  const bundle = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/component-contracts.tsx' })
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage(), errors: string[] = [], checks: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await gotoWithRetry(page, bundle.url)
    const oauth = page.getByTestId('oauth')
    await oauth.getByRole('button', { name: /Sign in with Claude/ }).click()
    const code = oauth.getByLabel('Authorization Code')
    await code.fill('   '); await oauth.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.equal(await page.evaluate(() => window.componentRecords.filter(item => item.action === 'code').length), 0)
    await code.fill('  saved-code  '); await oauth.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.componentRecords.find(item => item.action === 'code')?.values), ['saved-code'])
    checks.push('oauth-parent-start-and-trimmed-code')
    await page.evaluate(() => window.componentState({ validating: true }))
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#auth-code')?.disabled)
    assert(await oauth.getByRole('button', { name: 'Cancel', exact: true }).isDisabled())
    checks.push('oauth-validating-disabled')
    await page.evaluate(() => window.componentState({ validating: false, error: true }))
    await oauth.getByText('Recoverable fixture error').waitFor()
    await oauth.getByRole('button', { name: 'Cancel', exact: true }).click()
    await oauth.getByRole('button', { name: /Sign in with Claude/ }).waitFor()
    checks.push('oauth-error-and-parent-cancel')
    assert.equal(await page.getByTestId('hint').innerText(), 'Use source, MailProvider, screenshot, folder and Review in order.')
    checks.push('entity-labels-order-and-source-fallback')
    await page.getByTestId('model').getByRole('button').click()
    await page.getByText('alpha connection', { exact: true }).click()
    await page.getByText('alpha model two', { exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.componentRecords.at(-1)?.values), ['alpha-two', 'alpha'])
    await page.keyboard.press('Escape')
    await page.getByTestId('model').getByRole('button').click()
    await page.getByText('beta connection', { exact: true }).click()
    await page.getByText('beta model two', { exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.componentRecords.at(-1)?.values), ['beta-two', 'beta'])
    await page.keyboard.press('Escape'); checks.push('model-and-connection-one-selection-contract')
    await page.evaluate(() => window.componentState({ unavailable: true }))
    await page.getByTestId('model').getByRole('button', { name: 'Unavailable', exact: true }).waitFor()
    checks.push('unavailable-connection-visible')
    const tree = page.getByTestId('tree'), indent = tree.locator('div.w-4.shrink-0')
    assert.equal(await indent.count(), 4)
    const expandedText = await tree.innerText()
    await tree.getByRole('button', { name: 'Toggle activities' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="tree"] div.w-4.shrink-0').length === 0)
    await tree.getByRole('button', { name: 'Toggle activities' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="tree"] div.w-4.shrink-0').length === 4)
    assert.equal(await tree.innerText(), expandedText); checks.push('nested-activity-order-depth-collapse-expand')
    await page.screenshot({ path: join(run.directory, 'components.png'), fullPage: true })
    run.json('behavior.json', { checks, records: await page.evaluate(() => window.componentRecords), expandedText, errors })
    assert.deepEqual(errors, []); run.complete(checks, ['Full app keyboard/multiselect/navigation verified separately; no new behavior is introduced by private unused props'])
  } finally {
    run.json('browser-state.json', { errors, text: await page.locator('body').innerText().catch(() => '') })
    await page.screenshot({ path: join(run.directory, 'last-state.png'), fullPage: true }).catch(() => {})
    await context.close(); await launched.close(); await bundle.close()
  }
})

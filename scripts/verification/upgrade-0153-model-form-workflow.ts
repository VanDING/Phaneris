#!/usr/bin/env bun
/**
 * Model-form save protection (R10), driven through the real `ApiKeyInput` form.
 *
 * The scenes edit the shipped form — the key field, the two tier dropdowns and
 * the provider selector — and then submit it, asserting what a save actually
 * sends. The regression this covers: one "the default model did not change"
 * boolean decided the fate of the default model, the utility model AND the stored
 * model list, so editing only the utility model silently reverted it, and a
 * provider switch could resubmit the previous provider's catalog.
 *
 * Usage: bun run scripts/verification/upgrade-0153-model-form-workflow.ts
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('upgrade-0153-model-form', async run => {
  const launched = await launchWorkflowBrowser()
  const context = await launched.browser.newContext({ viewport: { width: 900, height: 1000 } })
  const page = await context.newPage()
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/api-key-form.tsx' })
  const errors: string[] = [], consoleErrors: string[] = []
  const checks: { id: string; passed: boolean; error?: string }[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  async function check(id: string, fn: () => Promise<void>) {
    try { await fn(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  const last = () => page.evaluate(() => window.apiKeyFixture.last())
  /** Reload so every scenario starts from the stored connection, not the previous scene's edits. */
  async function reloadForm() {
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForFunction(() => window.apiKeyFixture?.ready === true, undefined, { timeout: 60_000 })
    await page.getByTestId('api-key-input').waitFor()
    await page.waitForFunction(() => window.apiKeyFixture.catalogCalls().length > 0, undefined, { timeout: 30_000 })
    await page.waitForTimeout(300)
  }
  const reset = () => page.evaluate(() => window.apiKeyFixture.clear())
  /**
   * Open a tier dropdown and pick an entry by its visible name.
   *
   * The trigger has no test id of its own (adding one changes the element's
   * source fingerprint and therefore the visual-debt ledger), so it is located
   * through its label: the button is the only control in the label's row.
   */
  async function pickTier(tier: 'default' | 'utility', name: string) {
    const label = tier === 'default' ? 'Default model' : 'Utility model'
    const row = page.locator('div').filter({ has: page.getByText(label, { exact: false }) }).last()
    const trigger = row.getByRole('button').first()
    await trigger.click()
    await page.locator('[cmdk-item]').filter({ hasText: name }).first().click()
    await page.waitForTimeout(150)
  }

  try {
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForFunction(() => window.apiKeyFixture?.ready === true, undefined, { timeout: 90_000 })
    await page.getByTestId('api-key-input').waitFor()
    // The form hydrates from `getPiProviderModels`; wait for the first catalog.
    await page.waitForFunction(() => window.apiKeyFixture.catalogCalls().length > 0, undefined, { timeout: 30_000 })
    await page.waitForTimeout(300)

    await check('MF01-only-utility-changed', async () => {
      await reloadForm()
      await reset()
      await pickTier('utility', 'Kimi Legacy')
      await page.getByTestId('api-key-input').locator('button[type="submit"]').first().click().catch(async () => {
        await page.getByTestId('api-key-input').evaluate(form => (form as HTMLFormElement).requestSubmit())
      })
      await page.waitForFunction(() => window.apiKeyFixture.submissions.length > 0, undefined, { timeout: 15_000 })
      const submitted = await last()
      assert(submitted, 'the form must submit')
      assert.equal(submitted!.utilityModel, 'kimi-legacy', 'the chosen utility model must be saved')
      assert.equal(submitted!.connectionDefaultModel, 'kimi-k2', 'the untouched default model must be preserved')
      assert.deepEqual(submitted!.models, ['kimi-k2', 'kimi-k2-mini', 'kimi-legacy'],
        'an off-catalog stored model must survive a utility-only edit')
    })

    await check('MF02-utility-cleared-stays-cleared', async () => {
      await reloadForm()
      await reset()
      await pickTier('utility', 'Automatic')
      await page.getByTestId('api-key-input').evaluate(form => (form as HTMLFormElement).requestSubmit())
      await page.waitForFunction(() => window.apiKeyFixture.submissions.length > 0, undefined, { timeout: 15_000 })
      const submitted = await last()
      assert.equal(submitted!.utilityModel, null, 'clearing the utility model must submit a cleared value, not the stored one')
      assert.equal(submitted!.connectionDefaultModel, 'kimi-k2', 'the default model is untouched')
      assert.deepEqual(submitted!.models, ['kimi-k2', 'kimi-k2-mini', 'kimi-legacy'], 'the stored list is untouched')
    })

    await check('MF03-only-default-changed', async () => {
      await reloadForm()
      await reset()
      await pickTier('default', 'Kimi K2 Mini')
      await page.getByTestId('api-key-input').evaluate(form => (form as HTMLFormElement).requestSubmit())
      await page.waitForFunction(() => window.apiKeyFixture.submissions.length > 0, undefined, { timeout: 15_000 })
      const submitted = await last()
      assert.equal(submitted!.connectionDefaultModel, 'kimi-k2-mini', 'the chosen default must be saved')
      assert.deepEqual(submitted!.models, ['kimi-k2', 'kimi-k2-mini', 'kimi-legacy'],
        'an explicit default change submits the catalog list for this provider')
    })

    await check('MF04-only-key-changed-keeps-every-model-choice', async () => {
      await reloadForm()
      await reset()
      await page.getByPlaceholder(/pi-|sk-|Paste your key/).first().fill('rotated-key-123')
      await page.getByTestId('api-key-input').evaluate(form => (form as HTMLFormElement).requestSubmit())
      await page.waitForFunction(() => window.apiKeyFixture.submissions.length > 0, undefined, { timeout: 15_000 })
      const submitted = await last()
      assert.equal(submitted!.apiKey, 'rotated-key-123', 'the new key is submitted')
      assert.equal(submitted!.connectionDefaultModel, 'kimi-k2', 'a key-only edit must not rewrite the default model')
      assert.equal(submitted!.utilityModel, 'kimi-k2-mini', 'a key-only edit must not rewrite the utility model')
      assert.deepEqual(submitted!.models, ['kimi-k2', 'kimi-k2-mini', 'kimi-legacy'], 'a key-only edit must not rewrite the model list')
    })

    await check('MF05-provider-switch-does-not-carry-the-old-catalog', async () => {
      await reloadForm()
      await reset()
      await page.getByTestId('api-key-preset-trigger').click()
      await page.getByRole('option', { name: /OpenCode/i }).first().click().catch(async () => {
        await page.getByText('OpenCode', { exact: false }).first().click()
      })
      await page.waitForFunction(() => window.apiKeyFixture.catalogCalls().some(call => call.provider === 'opencode'), undefined, { timeout: 30_000 })
      await page.waitForTimeout(300)
      await page.getByTestId('api-key-input').evaluate(form => (form as HTMLFormElement).requestSubmit())
      await page.waitForFunction(() => window.apiKeyFixture.submissions.length > 0, undefined, { timeout: 15_000 })
      const submitted = await last()
      assert(!JSON.stringify(submitted).includes('kimi-legacy'), `the previous provider's off-catalog model must not travel to the new provider (${JSON.stringify(submitted)})`)
      assert.deepEqual(submitted!.models, ['opencode-sonnet', 'opencode-haiku'], 'the new provider submits its own catalog')
      assert.equal(submitted!.connectionDefaultModel, 'opencode-sonnet', 'the default comes from the new catalog')
      assert.equal(submitted!.utilityModel, null, 'no utility model was chosen for the new provider')
      await page.screenshot({ path: join(run.directory, 'model-form-opencode.png') })
    })

    const finalState = await page.evaluate(() => ({ submissions: window.apiKeyFixture.submissions, catalogCalls: window.apiKeyFixture.catalogCalls(), renders: window.apiKeyFixture.renders() }))
    run.json('model-form.json', { checks, finalState, pageErrors: errors, consoleErrors,
      fixtureSources: { form: 'apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx',
        fixture: 'scripts/verification/fixtures/api-key-form.tsx' } })
    run.complete(checks.filter(item => item.passed).map(item => item.id), [
      'a live provider validation round trip (status stays idle; the form submit path is what is asserted)',
      'the AI settings page around the form (the form itself is the shipped component)',
      'macOS/Linux execution',
    ])
    assert.equal(errors.length, 0, errors.join('\n'))
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'))
    assert(checks.every(item => item.passed), JSON.stringify(checks.filter(item => !item.passed)))
  } finally {
    await launched.close()
    await fixture.close()
    console.log(JSON.stringify({ passed: checks.filter(item => item.passed).length, total: checks.length, output: run.directory }))
  }
})

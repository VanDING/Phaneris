#!/usr/bin/env bun
/** Production controls → actual authenticated RPC/settings persistence, plus metering UI. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { projectDurableUsage } from '../../packages/server-core/src/runtime-adapters/session-projection'
import type { RuntimeUsageRow } from '../../packages/server-core/src/durable-runtime/store'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'
import { startProcess, testSecret } from './fixtures/governance-process-support'

await verificationWorkflow('upgrade-0153-followup-browser', async run => {
  const config = join(run.directory, 'config'), workspace = join(run.directory, 'workspace')
  mkdirSync(config, { recursive: true }); mkdirSync(workspace, { recursive: true })
  const configFile = join(config, 'config.json')
  writeFileSync(configFile, JSON.stringify({ workspaces: [{ id: 'fixture', name: 'Followup', rootPath: workspace, createdAt: 1 }], activeWorkspaceId: 'fixture', setupDeferred: true }))
  const launches: { url: string; stdout: string; stderr: string }[] = []
  let host = await startProcess({ config })
  const connect = async () => {
    const client = new WsRpcClient(host.url, { token: testSecret, workspaceId: 'fixture', autoReconnect: false, requestTimeout: 10_000 })
    await client.connect(); return client
  }
  let client = await connect()
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/upgrade-followup.tsx' })
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 980, height: 1100 } })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const page = await context.newPage(), errors: string[] = [], calls: { method: string; value?: unknown }[] = [], checks: string[] = []
  let failLoad = false, failSave = false, releaseLoad!: () => void, initialRead = true, loadStarted = false
  const heldLoad = new Promise<void>(resolve => { releaseLoad = resolve })
  const persisted = () => JSON.parse(readFileSync(configFile, 'utf8')).compactionThresholdTokens ?? null
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', event => { if (event.type() === 'error') errors.push(event.text()) })
  await page.exposeFunction('followupRpc', async (method: 'get' | 'set', value?: unknown) => {
    calls.push({ method, value })
    if (method === 'get') {
      if (failLoad) throw new Error('Fixture interrupted read')
      const result = await client.invoke(RPC_CHANNELS.caching.GET_COMPACTION_THRESHOLD)
      if (initialRead) { initialRead = false; loadStarted = true; await heldLoad }
      return result
    }
    if (failSave) throw new Error('Fixture interrupted write')
    return client.invoke(RPC_CHANNELS.caching.SET_COMPACTION_THRESHOLD, value)
  })
  const input = page.locator('#compaction-threshold-input')
  const blur = () => page.getByTestId('blur-target').click()
  const wait = async (probe: () => boolean | Promise<boolean>, label: string) => {
    const deadline = Date.now() + 15_000
    while (!await probe()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await Bun.sleep(25) }
  }
  try {
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForFunction(() => window.followupFixture?.ready)
    await wait(() => loadStarted, 'initial settings RPC')
    assert(await input.isDisabled()); assert.equal(persisted(), null)
    assert.equal(calls.filter(call => call.method === 'set').length, 0)
    releaseLoad(); await wait(async () => !await input.isDisabled(), 'loaded input')
    checks.push('pending-read-cannot-overwrite-stored-settings')

    await input.fill('1'); await blur()
    await page.getByText('Enter a whole number of at least 4,096 tokens, or leave blank.', { exact: true }).waitFor()
    assert.equal(persisted(), null)
    checks.push('invalid-form-value-is-not-written')
    await input.fill('64000'); await blur()
    await wait(() => persisted() === 64_000, 'persistent threshold')
    assert.equal(await client.invoke(RPC_CHANNELS.caching.GET_COMPACTION_THRESHOLD), 64_000)
    checks.push('production-input-saves-through-real-rpc-and-storage')

    for (const invalid of [-1, 0, 4095, 4096.5, '64000', {}, []]) {
      await assert.rejects(client.invoke(RPC_CHANNELS.caching.SET_COMPACTION_THRESHOLD, invalid), /Invalid compaction threshold/)
      assert.equal(persisted(), 64_000)
    }
    checks.push('rpc-invalid-values-have-no-persistence-effect')
    await wait(async () => !await input.isDisabled(), 'save settled')
    failSave = true; await input.fill('128000'); await blur()
    await page.getByText('Could not save the compaction threshold. Your input is preserved.', { exact: true }).waitFor()
    assert.equal(await input.inputValue(), '128000'); assert.equal(persisted(), 64_000)
    checks.push('failed-save-retains-user-input-and-previous-setting')
    failSave = false; await input.focus(); await blur()
    await wait(() => persisted() === 128_000, 'retry save')
    checks.push('failed-write-can-be-retried')

    failLoad = true; await page.evaluate(() => window.followupFixture.remount())
    await page.getByText('Could not load the compaction threshold.', { exact: true }).waitFor()
    assert(await input.isDisabled()); assert.equal(persisted(), 128_000)
    failLoad = false; await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await wait(async () => !await input.isDisabled(), 'retry load')
    assert.equal(await input.inputValue(), '128000')
    checks.push('failed-read-blocks-editing-and-explicit-retry-loads-current-value')
    await input.fill('96000')
    await page.evaluate(() => window.followupFixture.language('zh-Hans'))
    assert.equal(await input.inputValue(), '96000')
    await page.screenshot({ path: join(run.directory, 'threshold-zh.png'), fullPage: true })
    await blur(); await wait(() => persisted() === 96_000, 'language-preserved draft')
    checks.push('language-change-preserves-unsaved-threshold')

    await wait(async () => !await input.isDisabled(), 'save settled before clear')
    await input.fill(''); await blur(); await wait(() => persisted() === null, 'SDK default restored')
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(configFile, 'utf8')), 'compactionThresholdTokens'), false)
    checks.push('clearing-input-removes-override')
    await wait(async () => !await input.isDisabled(), 'clear settled')
    await input.fill('64000'); await blur(); await wait(() => persisted() === 64_000, 'saved before server restart')
    client.destroy(); await host.stop(); launches.push({ url: host.url, stdout: host.stdout(), stderr: host.stderr() })
    host = await startProcess({ config }); client = await connect()
    await page.evaluate(() => window.followupFixture.remount())
    await wait(async () => !await input.isDisabled(), 'reloaded after server restart')
    assert.equal(await input.inputValue(), '64000')
    checks.push('fresh-server-reads-the-persisted-override')

    const base = { operationId: 'ui-run', sessionId: 'ui-session', provider: 'fixture', model: 'fixture', createdAt: 1 }
    const unknown: RuntimeUsageRow = { ...base, usageId: 'unknown', payload: { costSource: 'unknown', metering: { status: 'unavailable' } } }
    const zero: RuntimeUsageRow = { ...base, usageId: 'zero', inputTokens: 0, outputTokens: 0, costUsd: 0, payload: { costSource: 'pi_sdk_estimate', metering: { status: 'reported' } } }
    const paid: RuntimeUsageRow = { ...base, usageId: 'paid', inputTokens: 1000, outputTokens: 50, costUsd: 0.0123, payload: { costSource: 'pi_sdk_estimate', metering: { status: 'reported' } } }
    const projections = { unknown: projectDurableUsage([unknown]), zero: projectDurableUsage([zero]), mixed: projectDurableUsage([unknown, paid]) }
    await page.evaluate(() => window.followupFixture.language('en'))
    await page.evaluate(value => window.followupFixture.show(value), projections)
    await page.getByTestId('metering-unknown').waitFor()
    const unknownText = await page.getByTestId('metering-unknown').innerText(), zeroText = await page.getByTestId('metering-zero').innerText(), mixedText = await page.getByTestId('metering-mixed').innerText()
    assert(unknownText.includes('Unknown')); assert(!unknownText.includes('$0.'))
    assert(zeroText.includes('$0.')); assert(!zeroText.includes('Unknown'))
    assert(mixedText.includes('$0.01') && mixedText.includes('Unknown'))
    checks.push('production-trajectory-distinguishes-unknown-zero-and-known-subtotal')
    const legacy = { ...zero, usageId: 'legacy', payload: { costSource: 'pi_sdk_estimate' } }
    const before = JSON.stringify(legacy), projectedLegacy = projectDurableUsage([legacy])
    assert.equal(JSON.stringify(legacy), before); assert.equal(projectedLegacy.costUsd, 0)
    checks.push('legacy-rows-remain-unchanged')
    await page.screenshot({ path: join(run.directory, 'metering-en.png'), fullPage: true })
    run.json('metering-ui.json', { projections, projectedLegacy, unknownText, zeroText, mixedText })
    assert.deepEqual(errors, [])
    run.complete(checks, ['Real provider billing statements', 'macOS/Linux, containers and signed installers'])
  } finally {
    releaseLoad()
    run.json('followup-browser.json', { checks, errors, calls, persisted: persisted() })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') })
    await launched.close(); await fixture.close()
    client.destroy(); await host.stop(); launches.push({ url: host.url, stdout: host.stdout(), stderr: host.stderr() })
    run.json('server-output.json', launches)
  }
})

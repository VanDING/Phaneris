#!/usr/bin/env bun
/**
 * Workspace isolation for Chat Starters (R9), through the real hook.
 *
 * The fixture mounts the production `useWorkspaceChatStarters` — the instance
 * `AppShell` itself uses — with host reads the driver resolves by hand. That is
 * what makes the ordering assertions real: an abandoned workspace can be made to
 * answer LAST, which is exactly how workspace A's starters used to overwrite
 * workspace B's, and how A's chips could be shown while B was still loading.
 *
 * Usage: bun run scripts/verification/upgrade-0153-workspace-isolation-workflow.ts
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'

const starter = (label: string) => ({ label, prompt: `${label} prompt` })

await verificationWorkflow('upgrade-0153-workspace-isolation', async run => {
  const launched = await launchWorkflowBrowser()
  const context = await launched.browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await context.newPage()
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/workspace-settings-isolation.tsx' })
  const errors: string[] = [], consoleErrors: string[] = []
  const checks: { id: string; passed: boolean; error?: string }[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  async function check(id: string, fn: () => Promise<void>) {
    try { await fn(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  const state = () => page.evaluate(() => ({
    shown: window.workspaceIsolationFixture.shown(),
    workspace: window.workspaceIsolationFixture.workspace(),
    calls: window.workspaceIsolationFixture.calls(),
    pending: window.workspaceIsolationFixture.pending().length,
  }))

  try {
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForFunction(() => window.workspaceIsolationFixture?.ready === true, undefined, { timeout: 90_000 })
    run.json('boot.json', { url: fixture.url, ready: true })
    // The first read for ws-a is pending; resolve it so the baseline is real.
    await page.evaluate(() => window.workspaceIsolationFixture.resolveCall(0, { chatStarters: [{ label: 'A starter', prompt: 'A prompt' }] }))
    await page.waitForFunction(() => window.workspaceIsolationFixture.shown().length === 1)

    // --- CSW-01: A→B, B answers first, A answers last ------------------------
    await check('CSW-01-late-response-from-abandoned-workspace-is-dropped', async () => {
      await page.evaluate(() => window.workspaceIsolationFixture.setWorkspace('ws-b'))
      // B is asked now; A's read is still outstanding.
      await page.waitForFunction(() => window.workspaceIsolationFixture.calls().some(call => call.workspaceId === 'ws-b'))
      const callsNow = await state()
      const bCall = callsNow.calls.find(call => call.workspaceId === 'ws-b')!.index
      await page.evaluate(({ index }) => window.workspaceIsolationFixture.resolveCall(index, {
        chatStarters: [{ label: 'B starter', prompt: 'B prompt' }],
      }), { index: bCall })
      await page.waitForFunction(() => window.workspaceIsolationFixture.shown().join(',') === 'B starter')

      // A late answer from A must not be able to overwrite B.
      const aLate = await page.evaluate(() => {
        const calls = window.workspaceIsolationFixture.calls()
        const a = calls.filter(call => call.workspaceId === 'ws-a').pop()
        const remaining = window.workspaceIsolationFixture.pending().length
        return { aIndex: a?.index ?? null, remaining }
      })
      if (aLate.aIndex !== null && aLate.remaining > 0) {
        await page.evaluate(({ index }) => window.workspaceIsolationFixture.resolveCall(index, {
          chatStarters: [{ label: 'A late', prompt: 'A prompt' }],
        }), { index: aLate.aIndex }).catch(() => {})
      }
      await page.waitForTimeout(300)
      const after = await state()
      assert.deepEqual(after.shown, ['B starter'], `A's late response must not replace B's starters (${JSON.stringify(after)})`)
      assert.equal(after.workspace, 'ws-b')
    })

    // --- CSW-02: B fails → nothing shown, never A's chips --------------------
    await check('CSW-02-failed-read-shows-nothing', async () => {
      await page.evaluate(() => window.workspaceIsolationFixture.setWorkspace('ws-c'))
      await page.waitForFunction(() => window.workspaceIsolationFixture.calls().some(call => call.workspaceId === 'ws-c'))
      const beforeAnswer = await state()
      assert.deepEqual(beforeAnswer.shown, [], 'a workspace that has not answered yet must show no starters')
      const call = beforeAnswer.calls.find(entry => entry.workspaceId === 'ws-c')!.index
      await page.evaluate(({ index }) => window.workspaceIsolationFixture.rejectCall(index, 'read failed'), { index: call })
      await page.waitForTimeout(300)
      assert.deepEqual((await state()).shown, [], "a failed read must not fall back to another workspace's starters")
    })

    // --- CSW-03: same workspace, two reads resolved out of order -------------
    await check('CSW-03-newest-read-wins', async () => {
      await page.evaluate(() => window.workspaceIsolationFixture.announce())
      await page.evaluate(() => window.workspaceIsolationFixture.announce())
      await page.waitForFunction(() => window.workspaceIsolationFixture.pending().length >= 2)
      const { calls: all } = await state()
      const [first, second] = all.slice(-2)
      // Answer the NEWER read first, then the older one.
      await page.evaluate(({ index }) => window.workspaceIsolationFixture.resolveCall(index, {
        chatStarters: [{ label: 'C2 newest', prompt: 'C2' }],
      }), { index: second!.index })
      await page.waitForFunction(() => window.workspaceIsolationFixture.shown().join(',') === 'C2 newest')
      await page.evaluate(({ index }) => window.workspaceIsolationFixture.resolveCall(index, {
        chatStarters: [{ label: 'C1 older', prompt: 'C1' }],
      }), { index: first!.index })
      await page.waitForTimeout(300)
      assert.deepEqual((await state()).shown, ['C2 newest'], 'the newest read must win, whatever answers last')
    })

    // --- CSW-04: no active workspace ---------------------------------------
    await check('CSW-04-no-active-workspace-shows-nothing', async () => {
      await page.evaluate(() => window.workspaceIsolationFixture.setWorkspace(null))
      await page.waitForFunction(() => window.workspaceIsolationFixture.shown().length === 0)
      const { shown, workspace } = await state()
      assert.equal(workspace, null)
      assert.deepEqual(shown, [], 'no active workspace means no chips')
    })

    // --- CSW-05: switching clears immediately, before the new read answers --
    await check('CSW-05-switch-clears-before-the-new-read-answers', async () => {
      await page.evaluate(() => window.workspaceIsolationFixture.setWorkspace('ws-d'))
      await page.waitForFunction(() => window.workspaceIsolationFixture.calls().some(call => call.workspaceId === 'ws-d'))
      const during = await state()
      assert.deepEqual(during.shown, [], 'workspace D must not show another workspace\'s starters while it loads')
      const call = during.calls.find(entry => entry.workspaceId === 'ws-d')!.index
      await page.evaluate(({ index }) => window.workspaceIsolationFixture.resolveCall(index, {
        chatStarters: [{ label: 'D starter', prompt: 'D' }],
      }), { index: call })
      await page.waitForFunction(() => window.workspaceIsolationFixture.shown().join(',') === 'D starter')
      await page.screenshot({ path: join(run.directory, 'workspace-isolation.png') })
    })

    const finalState = await state()
    run.json('workspace-isolation.json', { checks, finalState, pageErrors: errors, consoleErrors,
      fixtureSources: { hook: 'apps/electron/src/renderer/hooks/useWorkspaceChatStarters.ts',
        fixture: 'scripts/verification/fixtures/workspace-settings-isolation.tsx' } })
    run.complete(checks.filter(item => item.passed).map(item => item.id), [
      'a real AppShell window (the hook under test is the instance AppShell mounts)',
      'the settings page writing while the shell is loading',
      'macOS/Linux execution',
    ])
    assert.equal(errors.length, 0, errors.join('\n'))
    // One console line is expected: the hook logs the read failure that CSW-02
    // injects on purpose. Everything else must stay clean.
    const unexpectedConsoleErrors = consoleErrors.filter(message => !/\[Chat\] Failed to load workspace settings: Error: read failed/.test(message))
    assert.deepEqual(unexpectedConsoleErrors, [], unexpectedConsoleErrors.join('\n'))
    assert(checks.every(item => item.passed), JSON.stringify(checks.filter(item => !item.passed)))
  } finally {
    await launched.close()
    await fixture.close()
    console.log(JSON.stringify({ passed: checks.filter(item => item.passed).length, total: checks.length, output: run.directory }))
  }
})

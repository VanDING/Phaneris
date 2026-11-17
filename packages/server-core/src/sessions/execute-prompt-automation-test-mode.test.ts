import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager } from './SessionManager.ts'

// Regression test for craft-agents-oss#943:
//
//   The automation "Test" action awaited executePromptAutomation → sendMessage
//   to *full* completion. A prompt that used tools or produced >30s of output
//   tripped the 30s RPC client timeout and reported failure even though the
//   session streamed fine.
//
// The fix adds `waitForCompletion` to ExecutePromptAutomationInput. The Test
// handler passes `false` so the method returns once the session is created and
// the prompt is dispatched (fire-and-forget, error-logged). Real automation
// execution omits the flag and keeps awaiting completion.
//
// These tests stub createSession / sendEvent / submitInput and retain the
// original waiting contract: false resolves during a long turn; default waits
// for finished and propagates its error.

describe('executePromptAutomation waitForCompletion', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'exec-prompt-automation-'))
    sm = new SessionManager()
    // Stub the collaborators executePromptAutomation touches. With no labels /
    // mentions / llmConnection in the input, everything else is skipped.
    ;(sm as unknown as { createSession: unknown }).createSession = async () => ({ id: 'test-sess' })
    ;(sm as unknown as { sendEvent: unknown }).sendEvent = () => {}
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('waitForCompletion:false returns as soon as the session is created (does not await the turn)', async () => {
    let sendCalled = false
    // Never-resolving send simulates a long tool-using turn.
    sm.submitInput = () => {
      sendCalled = true
      return { accepted: Promise.resolve({ accepted: true as const, messageId: 'automation-fixture' }), finished: new Promise<never>(() => {}) }
    }

    const result = await sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'do something long',
      waitForCompletion: false,
    })

    expect(result.sessionId).toBe('test-sess')
    expect(sendCalled).toBe(true)
  })

  it('default (waitForCompletion unset) awaits sendMessage and propagates its error', async () => {
    sm.submitInput = () => ({ accepted: Promise.resolve({ accepted: true as const, messageId: 'automation-fixture' }), finished: Promise.reject(new Error('send failed')) })

    await expect(
      sm.executePromptAutomation({
        workspaceId: 'ws_test',
        workspaceRootPath: tmpRoot,
        prompt: 'do something',
      }),
    ).rejects.toThrow('send failed')
  })
})

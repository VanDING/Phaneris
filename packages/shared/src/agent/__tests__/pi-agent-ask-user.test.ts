/**
 * ask_user round-trip through the real PiAgent tool pipeline.
 *
 * These tests exercise the whole hang/wake chain without a model or a real
 * subprocess: a `tool_execute_request` arrives exactly as the Pi subprocess
 * would send it, the session tool handler blocks, the answer is delivered
 * through `respondToAskUser`, and the handler's result goes back as the tool's
 * result — which is what lets the turn continue instead of ending.
 */
import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'
import { AbortReason } from '../core/session-lifecycle.ts'
import type { AskUserQuestion } from '@phaneris/session-tools-core'

function createConfig(): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/phaneris-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/phaneris-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
  }
}

const questions: AskUserQuestion[] = [{
  id: 'approach',
  question: 'Which approach should I take?',
  options: [
    { label: 'Rewrite the parser (Recommended)' },
    { label: 'Patch the existing parser' },
  ],
}]

/** Sent frames the agent would have written to the Pi subprocess. */
interface SentFrame {
  type: string
  requestId?: string
  result?: { content: string; isError: boolean }
}

/**
 * Capture `send()` output and the ask_user request the UI would have received.
 *
 * Tool arguments are passed straight to the handler, so these tests reach the
 * same code path the model's call does — the model-facing schema only drops
 * `intent`, it does not change how a question is executed.
 */
function harness() {
  const agent = new PiAgent(createConfig())
  const sent: SentFrame[] = []
  const published: Array<{ requestId: string; questions: AskUserQuestion[] }> = []

  ;(agent as any).send = (cmd: Record<string, unknown>) => {
    sent.push(cmd as unknown as SentFrame)
  }
  agent.onAskUserRequest = (requestId, asked) => {
    published.push({ requestId, questions: asked })
  }

  const toolResponse = (requestId: string) =>
    sent.find(frame => frame.type === 'tool_execute_response' && frame.requestId === requestId)

  /** Dispatch one tool call and resolve once the matching response was sent. */
  const callTool = async (requestId: string, args: Record<string, unknown>): Promise<void> => {
    await (agent as any).handleToolExecuteRequest({
      requestId,
      toolName: 'mcp__session__ask_user',
      args,
    })
  }

  return { agent, sent, published, toolResponse, callTool }
}

/** Wait until `check()` holds, without assuming the handler's scheduling. */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('ask_user round-trip (hang → wake → tool result)', () => {
  it('publishes the question, blocks, then returns the answer as the tool result', async () => {
    const { agent, published, toolResponse, callTool } = harness()

    const inFlight = callTool('exec-1', { questions })

    // The handler must publish the question BEFORE it settles, or nobody could
    // ever answer it and the turn would hang with nothing on screen.
    await until(() => published.length === 1)
    expect(toolResponse('exec-1')).toBeUndefined()

    const { requestId } = published[0]!
    expect(published[0]!.questions).toEqual(questions)

    const delivered = agent.respondToAskUser(requestId, {
      answers: [{ id: 'approach', selected: ['Patch the existing parser'] }],
    })

    await inFlight
    expect(delivered).toBe(true)

    const response = toolResponse('exec-1')
    expect(response).toBeDefined()
    expect(response!.result?.isError).toBe(false)
    expect(JSON.parse(response!.result!.content)).toEqual({
      answers: [{ id: 'approach', selected: ['Patch the existing parser'] }],
    })

    agent.destroy()
  })

  it('reports a dismissal as a successful, non-blocking tool result', async () => {
    const { agent, published, toolResponse, callTool } = harness()

    const inFlight = callTool('exec-2', { questions })
    await until(() => published.length === 1)

    agent.respondToAskUser(published[0]!.requestId, { answers: [], cancelled: true })

    await inFlight
    const response = toolResponse('exec-2')
    expect(response!.result?.isError).toBe(false)
    expect(response!.result!.content).toContain('dismissed')
    expect(response!.result!.content).toContain('Do not immediately ask the same question again')

    agent.destroy()
  })

  it('settles an open question when the turn is aborted, so the handler cannot leak', async () => {
    const { agent, published, toolResponse, callTool } = harness()

    const inFlight = callTool('exec-3', { questions })
    await until(() => published.length === 1)

    // The user pressed stop while the question was on screen.
    agent.forceAbort(AbortReason.UserStop)

    await inFlight
    const response = toolResponse('exec-3')
    expect(response).toBeDefined()
    // Cancellation is an answer, not a transport crash: the model gets a normal
    // result telling it not to block.
    expect(response!.result?.isError).toBe(false)
    expect(response!.result!.content).toContain('dismissed')

    agent.destroy()
  })

  it('accepts an answer only once and ignores unknown request ids', async () => {
    const { agent, published, callTool } = harness()

    const inFlight = callTool('exec-4', { questions })
    await until(() => published.length === 1)
    const { requestId } = published[0]!

    expect(agent.respondToAskUser('ask-does-not-exist', { answers: [] })).toBe(false)
    expect(agent.respondToAskUser(requestId, { answers: [{ id: 'approach', selected: ['A'] }] })).toBe(true)
    // A second delivery for the same question must be refused rather than
    // resolving an already-settled promise.
    expect(agent.respondToAskUser(requestId, { answers: [{ id: 'approach', selected: ['B'] }] })).toBe(false)

    await inFlight
    agent.destroy()
  })

  it('cannot hibernate while a question is unanswered', async () => {
    const { agent, published, callTool } = harness()

    const inFlight = callTool('exec-5', { questions })
    await until(() => published.length === 1)

    // A hibernating agent would tear down the subprocess the answer must return to.
    expect(agent.canHibernate()).toBe(false)

    agent.respondToAskUser(published[0]!.requestId, { answers: [{ id: 'approach', selected: ['A'] }] })
    await inFlight
    expect((agent as any).pendingAskUser.size).toBe(0)

    agent.destroy()
  })

  it('rejects an unanswerable batch without publishing a question', async () => {
    const { agent, published, toolResponse, callTool } = harness()

    await callTool('exec-6', { questions: [] })

    expect(published).toHaveLength(0)
    expect(toolResponse('exec-6')!.result?.isError).toBe(true)

    agent.destroy()
  })
})

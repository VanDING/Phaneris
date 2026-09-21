/**
 * Context-policy stream wrapper.
 *
 * The wrapper sits at the provider boundary, so these tests drive it the way
 * the SDK does — one call per model request — and assert what the provider
 * actually receives: whether the ordinary request passes through, whether the
 * handoff document request replaces it, and what the caller observes.
 */
import { describe, expect, it } from 'bun:test'
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai'
import { createContextPolicyStream, type HandoffSignal } from './context-policy-stream.ts'
import type { ContextPolicy } from '../../shared/src/agent/context-policy.ts'

const model = {
  id: 'test-model', name: 'test', api: 'anthropic-messages' as const, provider: 'test',
  baseUrl: 'https://invalid.test', reasoning: false, input: ['text' as const],
  contextWindow: 128_000, maxTokens: 8192,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
} as unknown as Model<'anthropic-messages'>

const VALID_DOCUMENT = [
  '# Goal', 'Finish the context policy work.', '',
  '# Completed', 'Wired the SDK compaction toggle and the settings surface.', '',
  '# State', 'Modified packages/shared/src/agent/context-policy.ts; no external calls yet.', '',
  '# Next', 'Run the focused tests for the stream wrapper.', '',
  '# References', 'packages/pi-agent-server/src/context-policy-stream.ts',
].join('\n')

/** A committed assistant turn whose billed usage sets the measured occupancy. */
function billedTurn(tokens: number): AssistantMessage {
  return {
    role: 'assistant', api: 'anthropic-messages', provider: 'test', model: model.id, timestamp: 1,
    stopReason: 'stop', content: [{ type: 'text', text: 'work' }],
    usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
}

function contextWith(upTo: number): TranscriptContext {
  const messages: TranscriptContext['messages'] = [
    { role: 'system', content: 'base prompt', timestamp: 0 },
    { role: 'user', content: 'do the thing', timestamp: 0 },
    billedTurn(upTo),
  ]
  return { messages } as unknown as TranscriptContext
}

function textDocument(content: string): AssistantMessage {
  return {
    ...billedTurn(0),
    content: [{ type: 'text', text: content }],
    usage: { input: 0, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
}

/** An ordinary assistant reply, used when a test needs a pass-through answer. */
function plainAnswer(): AssistantMessage {
  return { ...textDocument('ordinary answer'), content: [{ type: 'text', text: 'ordinary answer' }] }
}

function streamOf(message: AssistantMessage): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  stream.push({ type: 'done', reason: message.stopReason as 'stop', message })
  return stream
}

async function collect(stream: ReturnType<typeof createAssistantMessageEventStream>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

/** Records every request the wrapper forwards to the provider. */
function harness(policy: ContextPolicy, forced = false) {
  const requests: Array<{ messages: TranscriptContext['messages']; options?: SimpleStreamOptions }> = []
  const signals: HandoffSignal[] = []
  let forcedPending = forced
  // First scripted answer is the handoff document; the second is an ordinary
  // reply, so a test may drive more than one request.
  const responses: AssistantMessage[] = [textDocument(VALID_DOCUMENT), plainAnswer()]

  const stream = createContextPolicyStream(
    ((_model, context, options) => {
      requests.push({ messages: context.messages, options })
      const message = responses.shift()
      if (!message) throw new Error('no scripted response')
      return streamOf(message)
    }) as never,
    () => policy,
    signal => signals.push(signal),
    () => { const value = forcedPending; forcedPending = false; return value },
  )
  return { stream, requests, signals }
}

describe('compact policy passes through', () => {
  it('never measures or intercepts a request', async () => {
    const { stream, requests, signals } = harness('compact')
    const events = await collect(stream(model, contextWith(127_000)) as never)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.messages).toHaveLength(3)
    expect(signals).toEqual([])
    expect(events.at(-1)!.type).toBe('done')
  })
})

describe('handoff policy below the trigger', () => {
  it('answers the user normally while the window still has room', async () => {
    const { stream, requests, signals } = harness('handoff')
    await collect(stream(model, contextWith(50_000)) as never)
    expect(requests).toHaveLength(1)
    expect(signals).toEqual([])
  })
})

describe('handoff policy above the trigger', () => {
  it('replaces the ordinary request with document generation and reserves its own output budget', async () => {
    const { stream, requests, signals } = harness('handoff')
    const events = await collect(stream(model, contextWith(110_000)) as never)

    expect(signals.map(signal => signal.phase)).toEqual(['generating', 'ready'])
    expect(signals[1]!.document).toBe(VALID_DOCUMENT)
    // One forwarded request: the document generation. The ordinary request never
    // reached the provider.
    expect(requests).toHaveLength(1)
    const sent = requests[0]!
    expect(sent.messages.at(-1)).toMatchObject({ role: 'user' })
    expect(String(sent.messages.at(-1)!.content)).toContain('# Goal')
    // Tools are withdrawn so the model cannot start new side effects mid-handoff.
    expect(sent.messages.at(-2)).toMatchObject({ role: 'system', toolsRemoved: expect.any(Array) })
    expect(sent.options?.maxTokens).toBe(8192)
    expect(sent.options?.reasoning).toBeUndefined()
    expect(events.at(-1)!.type).toBe('done')
  })

  it('fails closed when the model answers with an incomplete document', async () => {
    const requests: unknown[] = []
    const signals: HandoffSignal[] = []
    const wrapper = createContextPolicyStream(
      ((_model, context) => {
        requests.push(context)
        return streamOf(textDocument('# Goal\ntoo short to continue'))
      }) as never,
      () => 'handoff',
      signal => signals.push(signal),
      () => false,
    )
    const events = await collect(wrapper(model, contextWith(110_000)) as never)

    expect(signals.map(signal => signal.phase)).toEqual(['generating', 'failed'])
    // No success signal, and the provider call still terminates the request.
    expect(events.at(-1)).toMatchObject({ type: 'error' })
  })

  it('refuses to generate when the remaining room cannot hold the reservation', async () => {
    const requests: unknown[] = []
    const signals: HandoffSignal[] = []
    const wrapper = createContextPolicyStream(
      ((_model, context) => { requests.push(context); return streamOf(textDocument(VALID_DOCUMENT)) }) as never,
      () => 'handoff',
      signal => signals.push(signal),
      () => false,
    )
    const events = await collect(wrapper(model, contextWith(126_000)) as never)

    expect(signals).toEqual([{ phase: 'failed', error: expect.stringContaining('Not enough context') }])
    // Nothing was asked of the provider: an unreliable handoff is not attempted.
    expect(requests).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ type: 'error' })
  })
})

describe('forced handoff', () => {
  it('generates the document even when the budget would not have triggered', async () => {
    const { stream, requests, signals } = harness('handoff', true)
    await collect(stream(model, contextWith(1_000)) as never)
    expect(signals.map(signal => signal.phase)).toEqual(['generating', 'ready'])
    expect(requests).toHaveLength(1)
  })

  it('is consumed once, so the next request is measured normally again', async () => {
    const { stream, requests, signals } = harness('handoff', true)
    await collect(stream(model, contextWith(1_000)) as never)
    await collect(stream(model, contextWith(1_000)) as never)
    expect(signals.map(signal => signal.phase)).toEqual(['generating', 'ready'])
    // Second call is an ordinary pass-through: 2 requests total (doc + ordinary).
    expect(requests).toHaveLength(2)
  })
})

describe('manual policy', () => {
  it('runs normally while the window still has room', async () => {
    const { stream, requests, signals } = harness('manual')
    await collect(stream(model, contextWith(40_000)) as never)
    expect(requests).toHaveLength(1)
    expect(signals).toEqual([])
  })

  it('pauses with an explanation instead of compacting or handing off', async () => {
    const { stream, requests, signals } = harness('manual')
    const events = await collect(stream(model, contextWith(126_000)) as never)
    expect(requests).toHaveLength(0)
    expect(signals).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect((events.at(-1) as { error: AssistantMessage }).error.errorMessage).toContain('Context capacity reached')
  })
})

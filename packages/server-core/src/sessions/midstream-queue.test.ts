import { PiRuntimeDriver } from '../runtime-adapters/pi-driver'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SessionManager,
  createManagedSession,
  resolveMidStreamDeliveryOutcome,
  shouldAttemptMidStreamSteer,
} from './SessionManager.ts'
import { resolveMidStreamBehavior } from '@phaneris/shared/config'
import { resolveSessionConnection } from '@phaneris/shared/agent/backend'

describe('mid-stream queue runtime invariants', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-midstream-'))
    sm = new SessionManager()
    // This fixture pins configured delivery, independently of personal decision settings.
    ;(sm as any).decisionFeatureActive = () => false
  })

  afterEach(async () => {
    await sm.cleanup()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'mid-stream test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as any).registerManagedSession(managed)
    return managed
  }

  it('distinguishes non-interrupting queue mode from a failed steer', () => {
    expect(resolveMidStreamDeliveryOutcome('queue', false)).toEqual({
      shouldQueue: true,
      wasInterrupted: false,
    })
    expect(resolveMidStreamDeliveryOutcome('steer', false)).toEqual({
      shouldQueue: true,
      wasInterrupted: true,
    })
    expect(resolveMidStreamDeliveryOutcome('steer', true)).toEqual({
      shouldQueue: false,
      wasInterrupted: false,
    })
  })

  it('queues instead of steering while a manual compaction owns the turn (#1058)', () => {
    const compacting = { isCompactionInFlight: () => true }
    const idle = { isCompactionInFlight: () => false }
    expect(shouldAttemptMidStreamSteer('steer', compacting)).toBe(false)
    expect(shouldAttemptMidStreamSteer('steer', idle)).toBe(true)
    // Backends without the concept behave as before.
    expect(shouldAttemptMidStreamSteer('steer', {})).toBe(true)
    expect(shouldAttemptMidStreamSteer('queue', idle)).toBe(false)
    expect(shouldAttemptMidStreamSteer('steer', undefined)).toBe(false)
    // The forced queue path is not an interruption: the compaction runs to
    // completion and the replayed turn must not claim it was cut off.
    expect(resolveMidStreamDeliveryOutcome('queue', false)).toEqual({ shouldQueue: true, wasInterrupted: false })
    // A compaction-owned turn resolves through the *attempted* behavior, so a
    // steer that was never attempted can never report wasInterrupted.
    const attemptedSteer = shouldAttemptMidStreamSteer('steer', compacting)
    expect(resolveMidStreamDeliveryOutcome(attemptedSteer ? 'steer' : 'queue', false)).toEqual({
      shouldQueue: true,
      wasInterrupted: false,
    })
    // The uninterceptable case: feeding the requested behavior instead would
    // claim an interruption that never happened.
    expect(resolveMidStreamDeliveryOutcome('steer', false)).toEqual({
      shouldQueue: true,
      wasInterrupted: true,
    })
  })

  /** Minimal backend double: only the two members the mid-stream branch touches. */
  function setAgent(
    managed: ReturnType<typeof buildSession>,
    opts: { compactionInFlight?: boolean; redirectResult?: boolean },
  ) {
    const redirectCalls: string[] = []
    const handle = (sm as any).execution.current(managed.id)
    if (handle && !(sm as any).execution.view(managed.id).activeRunOperationId) {
      ;(sm as any).execution.accept(handle, { operationId: `${managed.id}:run`, userMessageId: `${managed.id}:input`, userMessage: 'foreground input' })
    }
    ;(sm as any).execution.installDriver(managed.id, new PiRuntimeDriver({
      redirect: (message: string) => {
        redirectCalls.push(message)
        return opts.redirectResult ?? true
      },
      // `compactionInFlight: undefined` models a backend without the concept.
      ...(opts.compactionInFlight === undefined
        ? {}
        : { isCompactionInFlight: () => opts.compactionInFlight === true }),
    } as never))
    return redirectCalls
  }

  function captureEvents() {
    const events: any[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))
    return events
  }

  /**
   * The mid-stream branch resolves steer-vs-queue from the *stored* default LLM
   * connection — a user config this suite does not own — so the steer-path
   * expectations are derived from the same public resolver the branch uses.
   * With no stored connection the resolver's `'steer'` fallback applies.
   */
  function midStreamMode(): 'steer' | 'queue' {
    const connection = resolveSessionConnection(undefined, undefined)
    return connection ? resolveMidStreamBehavior(connection) : 'steer'
  }

  it('mid-stream send during a manual compaction is queued for replay, not steered, and not an interruption', async () => {
    const sessionId = 'compaction-midstream'
    const managed = buildSession(sessionId)
    true && (sm as any).execution.begin({ sessionId: managed.id, workspaceRootPath: managed.workspace.rootPath })
    const redirectCalls = setAgent(managed, { compactionInFlight: true })
    const events = captureEvents()

    await sm.sendMessage(sessionId, 'queued behind the compaction')

    // redirect() never runs: the subprocess has no agent loop to consume a steer
    // (compact() aborts the live operation), so a "successful" steer would be lost.
    expect(redirectCalls).toEqual([])
    // Forced queue, NOT an interruption — the compaction runs to completion and
    // the replayed turn must not announce that its own answer was cut off.
    expect(managed.wasInterrupted).toBeUndefined()
    expect(managed.runtime.messageQueue).toHaveLength(1)
    expect(managed.runtime.messageQueue[0]?.message).toBe('queued behind the compaction')
    expect(events.find(event => event.type === 'user_message')?.status).toBe('queued')
  })

  it('non-compacting mid-stream send keeps the resolved behavior and stays non-interrupting', async () => {
    const sessionId = 'idle-midstream'
    const managed = buildSession(sessionId)
    true && (sm as any).execution.begin({ sessionId: managed.id, workspaceRootPath: managed.workspace.rootPath })
    const redirectCalls = setAgent(managed, { compactionInFlight: false })
    const events = captureEvents()

    await sm.sendMessage(sessionId, 'steer me')

    if (midStreamMode() === 'steer') {
      // Nothing changed for a normal in-flight turn: redirect() is attempted and
      // the message is delivered into the live turn.
      expect(redirectCalls).toEqual(['steer me'])
      expect(managed.runtime.messageQueue).toHaveLength(0)
      expect(events.find(event => event.type === 'user_message')?.status).toBe('accepted')
    } else {
      // A connection configured for queue mode never reaches redirect().
      expect(redirectCalls).toEqual([])
      expect(managed.runtime.messageQueue).toHaveLength(1)
      expect(events.find(event => event.type === 'user_message')?.status).toBe('queued')
    }
    // Holds either way: a send that was never aborted never claims an interruption.
    expect(managed.wasInterrupted).toBeUndefined()
  })

  it('a backend without the compaction concept is treated as not compacting', async () => {
    const sessionId = 'legacy-backend-midstream'
    const managed = buildSession(sessionId)
    true && (sm as any).execution.begin({ sessionId: managed.id, workspaceRootPath: managed.workspace.rootPath })
    // No `isCompactionInFlight` at all — the pre-#1058 backend contract.
    const redirectCalls = setAgent(managed, {})
    const events = captureEvents()

    await sm.sendMessage(sessionId, 'legacy steer')

    if (midStreamMode() === 'steer') {
      expect(redirectCalls).toEqual(['legacy steer'])
      expect(managed.runtime.messageQueue).toHaveLength(0)
      expect(events.find(event => event.type === 'user_message')?.status).toBe('accepted')
    }
    expect(managed.wasInterrupted).toBeUndefined()
  })

  it('a failed steer on a normal turn still marks the replay as interrupted', async () => {
    const sessionId = 'failed-steer-midstream'
    const managed = buildSession(sessionId)
    true && (sm as any).execution.begin({ sessionId: managed.id, workspaceRootPath: managed.workspace.rootPath })
    setAgent(managed, { compactionInFlight: false, redirectResult: false })
    captureEvents()

    await sm.sendMessage(sessionId, 'lost steer')

    expect(managed.runtime.messageQueue).toHaveLength(1)
    if (midStreamMode() === 'steer') {
      // The steer was attempted and the backend aborted the turn: the replay must
      // still be flagged as an interruption (pre-#1058 semantics, unchanged).
      expect(managed.wasInterrupted).toBe(true)
    } else {
      // Never attempted — nothing was aborted, so nothing was interrupted.
      expect(managed.wasInterrupted).toBeUndefined()
    }
  })

  it('re-stamps replay after the prior final response and emits that timestamp', async () => {
    const sessionId = 'queue-ordering'
    const managed = buildSession(sessionId)
    const priorFinalTimestamp = Date.now()
    managed.messages = [
      {
        id: 'initial-user',
        role: 'user',
        content: 'question',
        timestamp: priorFinalTimestamp - 200,
      },
      {
        id: 'queued-user',
        role: 'user',
        content: 'follow up',
        timestamp: priorFinalTimestamp - 100,
        isQueued: true,
      },
      {
        id: 'prior-answer',
        role: 'assistant',
        content: 'complete answer',
        timestamp: priorFinalTimestamp,
      },
    ]
    ;(sm as any).execution.enqueue(managed.id, {
      message: 'follow up',
      messageId: 'queued-user',
      optimisticMessageId: 'optimistic-user',
    })

    const events: any[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))
    ;(sm as unknown as { lastTimestamp: number }).lastTimestamp = priorFinalTimestamp
    ;(sm as unknown as { persistSession: () => void }).persistSession = () => {}
    const sendMessage = mock(async () => {})
    ;(sm as unknown as { sendMessage: typeof sendMessage }).sendMessage = sendMessage

    ;(sm as unknown as { processNextQueuedMessage: (id: string) => void })
      .processNextQueuedMessage(sessionId)
    await new Promise<void>(resolve => setImmediate(resolve))

    const replayed = managed.messages.find(message => message.id === 'queued-user')
    expect(replayed?.isQueued).toBe(false)
    expect(replayed?.timestamp).toBeGreaterThan(priorFinalTimestamp)

    const processingEvent = events.find(event => event.type === 'user_message')
    expect(processingEvent?.status).toBe('processing')
    expect(processingEvent?.message.timestamp).toBe(replayed?.timestamp)
    expect(processingEvent?.optimisticMessageId).toBe('optimistic-user')
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

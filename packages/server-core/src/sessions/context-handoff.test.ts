/**
 * Context handoff orchestration in SessionManager.
 *
 * These lock the reliability boundaries that decide whether a handoff loses the
 * user's work: the document is only recorded once it is complete on disk, a
 * cancelled handoff stays cancelled, and crash recovery reuses the successor
 * that was already created instead of spawning a second one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionPath } from '@phaneris/shared/sessions/storage'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type Managed = ReturnType<typeof createManagedSession>
type HandoffSignal = { phase: 'generating' | 'ready' | 'failed'; document?: string; error?: string }

/**
 * The handoff orchestration seams are private on purpose — nothing outside
 * SessionManager may drive them — and the injected session map is the only way
 * to build a session without a workspace registry. This is that one boundary;
 * every access below is a stable private member whose behaviour these tests
 * exist to pin.
 */
interface OrchestrationSeams {
  sessions: Map<string, Managed>
  recordContextHandoff(managed: Managed, event: HandoffSignal): Promise<void>
  recoverContextHandoffs(): Promise<void>
}

const DOCUMENT = [
  '# Goal', 'Finish the context policy work.', '',
  '# Completed', 'Wired the SDK compaction toggle and the settings surface.', '',
  '# State', 'Modified packages/shared/src/agent/context-policy.ts; no external calls yet.', '',
  '# Next', 'Run the focused tests for the stream wrapper.', '',
  '# References', 'packages/pi-agent-server/src/context-policy-stream.ts',
].join('\n')

describe('context handoff orchestration', () => {
  let tmpRoot: string
  let sm: SessionManager
  let seams: OrchestrationSeams

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-handoff-'))
    sm = new SessionManager()
    seams = sm as unknown as OrchestrationSeams
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string, messages: Array<{ id: string; role: 'user'; content: string; isQueued?: boolean }> = []) {
    const workspace = { id: 'ws_test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    const managed = createManagedSession(
      { id, name: 'handoff test' },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.messages = messages.map(message => ({ ...message, timestamp: Date.now() })) as never
    seams.sessions.set(id, managed)
    return managed
  }

  function persistedState(id: string) {
    const path = join(getSessionPath(tmpRoot, id), 'session.jsonl')
    if (!existsSync(path)) return undefined
    const header = JSON.parse(readFileSync(path, 'utf-8').split('\n')[0]!)
    return { contextHandoff: header.contextHandoff, contextPolicy: header.contextPolicy }
  }

  it('records a complete document on disk before reporting the handoff ready', async () => {
    const managed = buildSession('handoff-ready', [{ id: 'm1', role: 'user', content: 'do it' }])
    await seams.recordContextHandoff(managed, { phase: 'generating' })
    expect(managed.contextHandoff?.phase).toBe('generating')
    expect(managed.contextHandoff?.cutoffMessageId).toBe('m1')

    await seams.recordContextHandoff(managed, { phase: 'ready', document: DOCUMENT })

    expect(managed.contextHandoff?.phase).toBe('ready')
    const documentPath = managed.contextHandoff!.documentPath!
    expect(readFileSync(documentPath, 'utf-8')).toBe(DOCUMENT)
    // The atomic write leaves no temp file behind for recovery to mistake for a document.
    expect(existsSync(`${documentPath}.tmp`)).toBe(false)
    expect(persistedState('handoff-ready')?.contextHandoff?.phase).toBe('ready')
  })

  it('fails the handoff instead of dispatching a document the model left incomplete', async () => {
    const managed = buildSession('handoff-invalid')
    await seams.recordContextHandoff(managed, { phase: 'generating' })
    await seams.recordContextHandoff(managed, { phase: 'ready', document: '# Goal\nnothing else' })

    expect(managed.contextHandoff?.phase).toBe('failed')
    expect(managed.contextHandoff?.documentPath).toBeUndefined()
    expect(existsSync(join(getSessionPath(tmpRoot, 'handoff-invalid'), 'handoffs'))).toBe(false)
  })

  it('never resurrects a cancelled handoff when the document arrives late', async () => {
    const managed = buildSession('handoff-cancelled')
    await seams.recordContextHandoff(managed, { phase: 'generating' })
    managed.contextHandoff = { ...managed.contextHandoff!, phase: 'cancelled' }

    await seams.recordContextHandoff(managed, { phase: 'ready', document: DOCUMENT })

    expect(managed.contextHandoff.phase).toBe('cancelled')
    expect(existsSync(join(getSessionPath(tmpRoot, 'handoff-cancelled'), 'handoffs'))).toBe(false)
  })

  it('turns a handoff interrupted by shutdown into an explicit retryable failure', async () => {
    const managed = buildSession('handoff-restart')
    await seams.recordContextHandoff(managed, { phase: 'generating' })

    await seams.recoverContextHandoffs()

    expect(managed.contextHandoff?.phase).toBe('failed')
    expect(managed.contextHandoff?.error).toContain('Retry')
    expect(persistedState('handoff-restart')?.contextHandoff?.phase).toBe('failed')
  })

  it('reuses the successor created before the crash instead of spawning a second one', async () => {
    const managed = buildSession('handoff-dedupe')
    await seams.recordContextHandoff(managed, { phase: 'generating' })
    await seams.recordContextHandoff(managed, { phase: 'ready', document: DOCUMENT })
    const documentPath = managed.contextHandoff!.documentPath!

    // The successor was created and its seed persisted before the parent could
    // record `starting`; recovery must adopt it, not create another.
    const child = buildSession('handoff-dedupe-1', [{ id: 'seed', role: 'user', content: 'continue' }])
    child.handoffFromSessionId = 'handoff-dedupe'
    child.handoffRootSessionId = 'handoff-dedupe'
    managed.contextHandoff = { ...managed.contextHandoff!, phase: 'starting', childSessionId: child.id }

    await seams.recoverContextHandoffs()

    expect(managed.contextHandoff?.phase).toBe('complete')
    expect(managed.contextHandoff?.childSessionId).toBe('handoff-dedupe-1')
    expect(managed.contextHandoff?.documentPath).toBe(documentPath)
    expect([...seams.sessions.values()].filter(s => s.handoffFromSessionId === 'handoff-dedupe')).toHaveLength(1)
  })

  it('leaves a handoff whose document never materialised untouched rather than dispatching an empty continuation', async () => {
    const managed = buildSession('handoff-no-doc')
    managed.contextHandoff = { id: 'h2', phase: 'starting', childSessionId: 'ghost' }

    await seams.recoverContextHandoffs()

    expect(managed.contextHandoff.phase).toBe('starting')
    expect(existsSync(join(getSessionPath(tmpRoot, 'handoff-no-doc'), 'handoffs'))).toBe(false)
    expect([...seams.sessions.values()].filter(s => s.handoffFromSessionId === 'handoff-no-doc')).toHaveLength(0)
  })

  it('keeps the document and records a retryable failure when the successor cannot be created', async () => {
    const managed = buildSession('handoff-scoped')
    await seams.recordContextHandoff(managed, { phase: 'generating' })
    await seams.recordContextHandoff(managed, { phase: 'ready', document: DOCUMENT })
    const documentPath = managed.contextHandoff!.documentPath!

    // No workspace registry in this harness, so successor creation fails. The
    // document must survive: the user retries instead of losing the handoff.
    await seams.recoverContextHandoffs()

    expect(managed.contextHandoff?.phase).toBe('failed')
    expect(managed.contextHandoff?.error).toContain('Workspace')
    expect(readFileSync(documentPath, 'utf-8')).toBe(DOCUMENT)
    expect(persistedState('handoff-scoped')?.contextHandoff?.phase).toBe('failed')
  })

  it('rewrites only the handing-off session and leaves unrelated sessions untouched', async () => {
    buildSession('handoff-other')
    const managed = buildSession('handoff-ready-other')
    await seams.recordContextHandoff(managed, { phase: 'generating' })

    await seams.recoverContextHandoffs()

    expect(persistedState('handoff-other')?.contextHandoff).toBeUndefined()
    expect(persistedState('handoff-ready-other')?.contextHandoff?.phase).toBe('failed')
  })
})

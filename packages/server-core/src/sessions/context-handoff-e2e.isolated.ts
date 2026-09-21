/**
 * Context handoff end to end: from a ready document to a live continuation session.
 *
 * The sibling `context-handoff.test.ts` covers the recording seams without a
 * workspace registry. This one owns a real config root so `createSession` runs
 * for real, which is the only way to assert what the successor actually
 * inherits and what the first message it receives contains.
 *
 * Isolated process: `getWorkspaces()` reads the config root captured at module
 * load, so this file must own `PHANERIS_CONFIG_DIR` before importing.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const configDir = mkdtempSync(join(tmpdir(), 'phaneris-handoff-e2e-'))
const workspaceRoot = mkdtempSync(join(tmpdir(), 'phaneris-handoff-ws-'))
process.env.PHANERIS_CONFIG_DIR = configDir

mkdirSync(join(workspaceRoot, 'sessions'), { recursive: true })
writeFileSync(join(configDir, 'config.json'), JSON.stringify({
  workspaces: [{ id: 'ws_e2e', name: 'Handoff Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
  activeWorkspaceId: 'ws_e2e',
  activeSessionId: null,
  llmConnections: [],
  defaultLlmConnection: undefined,
}), 'utf-8')

const { SessionManager, createManagedSession } = await import('./SessionManager.ts')
const { getSessionPath } = await import('@phaneris/shared/sessions/storage')

const DOCUMENT = [
  '# Goal', 'Finish the context policy work.', '',
  '# Completed', 'Wired the SDK compaction toggle and the settings surface.', '',
  '# State', 'Modified packages/shared/src/agent/context-policy.ts; no external calls yet.', '',
  '# Next', 'Run the focused tests for the stream wrapper.', '',
  '# References', 'packages/pi-agent-server/src/context-policy-stream.ts',
].join('\n')

type Managed = ReturnType<typeof createManagedSession>
interface Seams {
  sessions: Map<string, Managed>
  recordContextHandoff(managed: Managed, event: { phase: 'generating' | 'ready' | 'failed'; document?: string; error?: string }): Promise<void>
  startContextSuccessor(managed: Managed): Promise<void>
}

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true })
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('handoff successor creation', () => {
  it('inherits the working context, records its lineage, and receives the document as its first message', async () => {
    const sm = new SessionManager()
    const seams = sm as unknown as Seams
    const managed = createManagedSession(
      { id: 'parent', name: 'Parent task', permissionMode: 'ask' },
      { id: 'ws_e2e', name: 'Handoff Workspace', rootPath: workspaceRoot, createdAt: Date.now() } as never,
      { messagesLoaded: true },
    )
    managed.messages = [{ id: 'm1', role: 'user', content: 'do the thing', timestamp: Date.now() } as never]
    managed.workingDirectory = workspaceRoot
    managed.model = 'fixture-model'
    seams.sessions.set('parent', managed)

    await seams.recordContextHandoff(managed, { phase: 'generating' })
    await seams.recordContextHandoff(managed, { phase: 'ready', document: DOCUMENT })
    // Successor creation also dispatches the seed; that dispatch reaches agent
    // creation and fails without a provider, which is past every assertion here.
    await seams.startContextSuccessor(managed).catch(() => { /* agent init is out of scope */ })
    await new Promise(resolve => setTimeout(resolve, 50))

    const successors = [...seams.sessions.values()].filter(session => session.handoffFromSessionId === 'parent')
    expect(successors).toHaveLength(1)
    const child = successors[0]!

    // Flat under the chain root for the UI; the direct predecessor is recorded
    // separately so the true handoff chain survives.
    expect(child.parentSessionId).toBe('parent')
    expect(child.handoffRootSessionId).toBe('parent')
    expect(child.handoffSequence).toBe(1)
    expect(child.workingDirectory).toBe(workspaceRoot)
    expect(child.model).toBe('fixture-model')
    expect(child.permissionMode).toBe('ask')
    expect(child.contextPolicy).toBeUndefined()

    // The parent is now complete and its successor is reachable from it.
    expect(managed.contextHandoff?.phase).toBe('complete')
    expect(managed.contextHandoff?.childSessionId).toBe(child.id)

    const childHeader = JSON.parse(readFileSync(join(getSessionPath(workspaceRoot, child.id), 'session.jsonl'), 'utf-8').split('\n')[0]!)
    expect(childHeader.handoffFromSessionId).toBe('parent')
    expect(childHeader.handoffRootSessionId).toBe('parent')
    // Once 'complete' is recorded the handoff is never restarted, so recovery
    // scans for it and must find the successor it already has.
    expect(existsSync(managed.contextHandoff!.documentPath!)).toBe(true)

    const childTranscript = readFileSync(join(getSessionPath(workspaceRoot, child.id), 'session.jsonl'), 'utf-8')
    expect(childTranscript).toContain('Original session: parent')
    expect(childTranscript).toContain('Previous session: parent')
    expect(childTranscript).toContain('Handoff file: ')
    expect(childTranscript).toContain('# Next')
    expect(childTranscript).toContain('Run the focused tests for the stream wrapper.')
  })

  it('forwards a message typed into the finished handoff to the continuation', async () => {
    const sm = new SessionManager()
    const seams = sm as unknown as Seams
    const parent = createManagedSession(
      { id: 'parent2', name: 'Parent task' },
      { id: 'ws_e2e', name: 'Handoff Workspace', rootPath: workspaceRoot, createdAt: Date.now() } as never,
      { messagesLoaded: true },
    )
    seams.sessions.set('parent2', parent)

    await seams.recordContextHandoff(parent, { phase: 'generating' })
    await seams.recordContextHandoff(parent, { phase: 'ready', document: DOCUMENT })
    await seams.startContextSuccessor(parent).catch(() => { /* agent init is out of scope */ })
    await new Promise(resolve => setTimeout(resolve, 50))
    const childId = parent.contextHandoff!.childSessionId!
    expect(childId).toBeTruthy()

    const events: Array<{ sessionId: string; status: string }> = []
    ;(sm as unknown as { eventSink: unknown }).eventSink = (_channel: string, _target: unknown, event: { type: string; sessionId: string; status?: string }) => {
      if (event.type === 'user_message') events.push({ sessionId: event.sessionId, status: event.status ?? '' })
    }

    await sm.sendMessage('parent2', 'also rename the flag').catch(() => { /* agent init is out of scope */ })
    await new Promise(resolve => setTimeout(resolve, 50))

    // The message lands on the successor; the parent only echoes a confirmation
    // so its composer does not keep a pending bubble.
    const childTranscript = readFileSync(join(getSessionPath(workspaceRoot, childId), 'session.jsonl'), 'utf-8')
    expect(childTranscript).toContain('also rename the flag')
    const echoed = events.filter(event => event.sessionId === 'parent2')
    expect(echoed).toHaveLength(1)
    expect(echoed[0]!.status).toBe('accepted')
  })
})

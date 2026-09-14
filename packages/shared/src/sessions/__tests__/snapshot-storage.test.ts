import { expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readSessionJsonl, writeSessionJsonl } from '../jsonl'
import { SessionPersistenceQueue } from '../persistence-queue'
import { getSessionFilePath } from '../storage'
import type { StoredSession } from '../types'

it('both persistence paths compact snapshots, restore exact messages and reject broken references', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-storage-'))
  try {
    const session = { id: 'snapshot', workspaceRootPath: dir, createdAt: 1, lastUsedAt: 2, tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }, messages: Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, type: 'assistant', content: 'reply', timestamp: i, promptSnapshot: 'system'.repeat(10000), contextSnapshot: { tools: [{ name: 'tool', description: 'schema'.repeat(1000) }] } })) } as unknown as StoredSession
    const path = join(dir, 'sync.jsonl')
    writeSessionJsonl(path, session)
    const encoded = readFileSync(path, 'utf8')
    expect(encoded.length).toBeLessThan(JSON.stringify(session).length / 5)
    expect(readSessionJsonl(path)?.messages).toEqual(session.messages)
    const queue = new SessionPersistenceQueue(60_000)
    queue.enqueue(session)
    await queue.flush(session.id)
    const asyncPath = getSessionFilePath(dir, session.id)
    expect(readSessionJsonl(asyncPath)?.messages).toEqual(session.messages)
    expect(readFileSync(asyncPath, 'utf8').length).toBeLessThan(JSON.stringify(session).length / 5)
    const movedDir = join(dir, 'moved')
    mkdirSync(movedDir)
    const portablePrompt = dir.replaceAll('\\', '/') + '/evidence.txt'
    const portableSession = { ...session, messages: session.messages.map(message => ({ ...message, promptSnapshot: portablePrompt })) }
    const portablePath = join(dir, 'portable.jsonl')
    writeSessionJsonl(portablePath, portableSession)
    const movedPath = join(movedDir, 'session.jsonl')
    writeFileSync(movedPath, readFileSync(portablePath))
    expect(readSessionJsonl(movedPath)?.messages.map(message => message.promptSnapshot)).toEqual(session.messages.map(() => movedDir.replaceAll('\\', '/') + '/evidence.txt'))
    const lines = encoded.trimEnd().split('\n')
    writeFileSync(path, [lines[0], ...lines.slice(2)].join('\n') + '\n')
    expect(() => readSessionJsonl(path)).toThrow('Missing')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

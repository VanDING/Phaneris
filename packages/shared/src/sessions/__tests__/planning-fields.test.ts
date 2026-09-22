import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, loadSession } from '../storage.ts'

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

describe('Session planning metadata', () => {
  it('round-trips the fields shared by kanban, calendar, and timeline projections', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'phaneris-session-planning-'))
    workspaces.push(workspace)

    const created = await createSession(workspace, {
      name: 'Ship planning views',
      description: 'Use one Session as the source of truth.',
      acceptanceCriteria: 'All projections show the same dates.',
      startAt: '2026-09-22',
      dueAt: '2026-09-25T17:00',
      progress: 35,
      dependencySessionIds: ['dependency-session'],
      isMilestone: false,
    })
    const loaded = loadSession(workspace, created.id)

    expect(loaded).toMatchObject({
      description: 'Use one Session as the source of truth.',
      acceptanceCriteria: 'All projections show the same dates.',
      startAt: '2026-09-22',
      dueAt: '2026-09-25T17:00',
      progress: 35,
      dependencySessionIds: ['dependency-session'],
      isMilestone: false,
    })
  })
})

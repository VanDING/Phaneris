import { describe, expect, it } from 'bun:test'
import { rollbackFailedBranchCreation } from '@phaneris/server-core/domain'

describe('rollbackFailedBranchCreation', () => {
  it('cleans runtime + storage and tears down agent/pool on preflight failure', async () => {
    let destroyed = false
    let stopped = false
    let runtimeDeleted: string | null = null
    let storageDeleted: string | null = null

    await rollbackFailedBranchCreation({
      disposeRuntime: async () => {
        destroyed = true
        stopped = true
      },
      workspaceRootPath: '/tmp/ws',
      sessionId: 'child-1',
      deleteFromRuntimeSessions: (id) => {
        runtimeDeleted = id
      },
      deleteStoredSession: async (_root, id) => {
        storageDeleted = id
      },
    })

    expect(destroyed).toBe(true)
    expect(stopped).toBe(true)
    expect(runtimeDeleted as string | null).toBe('child-1')
    expect(storageDeleted as string | null).toBe('child-1')
  })

  it('still deletes sessions when owner disposal throws (best-effort)', async () => {
    let runtimeDeleted = false
    let storageDeleted = false

    await rollbackFailedBranchCreation({
      disposeRuntime: async () => { throw new Error('runtime disposal failed') },
      workspaceRootPath: '/tmp/ws',
      sessionId: 'child-2',
      deleteFromRuntimeSessions: () => {
        runtimeDeleted = true
      },
      deleteStoredSession: async () => {
        storageDeleted = true
      },
    })

    expect(runtimeDeleted).toBe(true)
    expect(storageDeleted).toBe(true)
  })

  it('does not throw when storage deletion fails', async () => {
    let runtimeDeleted = false

    await rollbackFailedBranchCreation({
      disposeRuntime: async () => {},
      workspaceRootPath: '/tmp/ws',
      sessionId: 'child-3',
      deleteFromRuntimeSessions: () => {
        runtimeDeleted = true
      },
      deleteStoredSession: async () => {
        throw new Error('storage delete failed')
      },
    })

    expect(runtimeDeleted).toBe(true)
  })
})

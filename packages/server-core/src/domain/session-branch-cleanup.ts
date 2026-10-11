interface RollbackParams {
  disposeRuntime: () => void | Promise<void>
  workspaceRootPath: string
  sessionId: string
  deleteFromRuntimeSessions: (sessionId: string) => void
  deleteStoredSession: (workspaceRootPath: string, sessionId: string) => void | boolean | Promise<void | boolean>
}

/**
 * Best-effort rollback when branch creation fails during backend preflight.
 * Ensures no orphan child session remains in memory or persistent storage.
 */
export async function rollbackFailedBranchCreation(params: RollbackParams): Promise<void> {
  const { disposeRuntime, workspaceRootPath, sessionId, deleteFromRuntimeSessions, deleteStoredSession } = params

  try {
    await disposeRuntime()
  } catch {
    // Best-effort cleanup: session deletion still runs if the owner cannot dispose.
  }

  deleteFromRuntimeSessions(sessionId)

  try {
    await deleteStoredSession(workspaceRootPath, sessionId)
  } catch {
    // Best-effort rollback: runtime cleanup is the critical path.
  }
}

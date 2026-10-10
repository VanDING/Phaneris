import { DurableRuntimeCoordinator } from '../coordinator.js'

/** Offline backup client owns no execution capability and cannot expose a Store. */
export function backupRuntimeDatabase(workspaceRoot: string, destination: string): string {
  const kernel = new DurableRuntimeCoordinator()
  try { return kernel.backupDatabase(workspaceRoot, destination) }
  finally { kernel.closeAll() }
}

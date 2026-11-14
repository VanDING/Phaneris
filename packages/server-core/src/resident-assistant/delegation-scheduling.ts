import { join } from 'node:path'
import { AssistantTasksSchema } from '@phaneris/shared/config/schemas'
import { loadWorkspaceConfig } from '@phaneris/shared/workspaces'
import type { SessionDelegationInput } from '@phaneris/core/types'
import type { AssistantDelegationReceipt } from '@phaneris/session-tools-core/delegation-contracts'
import { acquireFileScopes, releaseFileScopes, snapshotFileScope, onFileScopesReleased, fileScopesConflict } from '../tasks/file-scopes'

/** Configuration is parsed once at its owning read boundary, never clamped
 * silently into a different advertised capacity. */
export function assistantTaskCapacity(root: string): number {
  const settings = loadWorkspaceConfig(root)?.assistantTasks
  return settings === undefined ? 4 : AssistantTasksSchema.parse(settings).concurrency
}

/** Uses the existing process-wide Tasks leases, including their wakeups. No
 * separate work store, Runtime slot or general-purpose lock service. */
export class DelegationResources {
  private readonly leases = new Map<string, { token: object; input: SessionDelegationInput; sessionId: string; scope: string }>()
  private readonly unsubscribe: () => void
  constructor(private readonly root: string, wake: () => void) { this.unsubscribe = onFileScopesReleased(wake) }
  private scope(input: SessionDelegationInput, sessionId: string) {
    const cwd = input.effectiveConfig.workingDirectory === 'none' ? join(this.root, 'sessions', sessionId) : input.effectiveConfig.workingDirectory
    return snapshotFileScope(cwd, input.fileScope ?? (input.effectiveConfig.permissionMode === 'safe' ? { read: ['.'], write: [] } : undefined))
  }
  conflictsWithUncertain(input: SessionDelegationInput, sessionId: string, held: SessionDelegationInput, heldSessionId: string): boolean {
    if (input.effectiveConfig.workingDirectory === 'none' && !input.fileScope) return false
    const cwd = held.effectiveConfig.workingDirectory === 'none' ? join(this.root, 'sessions', heldSessionId) : held.effectiveConfig.workingDirectory
    // An undeclared scope held by an interrupted/recovered assignment remains
    // exclusive until inspected. Explicit scopes retain their exact boundary.
    return fileScopesConflict(this.scope(input, sessionId), snapshotFileScope(cwd, held.fileScope))
  }
  refresh(receipts: readonly AssistantDelegationReceipt[], held: readonly string[]): void {
    const retained = new Set(receipts.filter(receipt => ['submitting', 'submitted', 'cancel_requested', 'pause_requested', 'needs_attention'].includes(receipt.state)
      || !!receipt.sessionId && held.includes(receipt.sessionId)).map(receipt => receipt.id))
    for (const [id, lease] of this.leases) if (!retained.has(id)) { this.leases.delete(id); releaseFileScopes(lease.token) }
  }
  acquire(receipt: AssistantDelegationReceipt, input: SessionDelegationInput): boolean {
    const previous = this.leases.get(receipt.id), token = previous?.token ?? {}, scope = this.scope(input, receipt.sessionId!)
    if (!acquireFileScopes(token, scope)) return false
    this.leases.set(receipt.id, { token, input, sessionId: receipt.sessionId!, scope: JSON.stringify(scope) })
    return true
  }
  valid(id: string): boolean {
    const lease = this.leases.get(id)
    return !!lease && lease.scope === JSON.stringify(this.scope(lease.input, lease.sessionId))
  }
  close(): void { this.unsubscribe(); for (const lease of this.leases.values()) releaseFileScopes(lease.token); this.leases.clear() }
}

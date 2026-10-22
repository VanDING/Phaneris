/** Product configuration snapshot. Runtime execution state is never an input. */
import type { CoreBackendConfig } from '@phaneris/shared/agent/backend'
import type { SessionTaskContext } from '@phaneris/shared/sessions'

type AgentSessionConfig = NonNullable<CoreBackendConfig['session']>
export type AgentProductContext = AgentSessionConfig & { readonly branchContextStrategy?: string }

/** Copy a finite product view; never expose Manager or mutable execution state. */
export function buildSessionTaskContext(product: Readonly<SessionTaskContext>): SessionTaskContext {
  return {
    id: product.id, name: product.name, description: product.description, acceptanceCriteria: product.acceptanceCriteria,
    progress: product.progress, startAt: product.startAt, dueAt: product.dueAt, parentSessionId: product.parentSessionId,
    dependencySessionIds: product.dependencySessionIds ? [...product.dependencySessionIds] : undefined,
    sessionStatus: product.sessionStatus,
  }
}

export function buildAgentSessionSnapshot(product: Readonly<AgentProductContext>): AgentSessionConfig {
  const fork = product.branchContextStrategy === 'sdk-fork'
  return {
    ...buildSessionTaskContext(product), workspaceRootPath: product.workspaceRootPath, sdkSessionId: product.sdkSessionId,
    branchFromSdkSessionId: fork ? product.branchFromSdkSessionId : undefined,
    branchFromSessionPath: fork ? product.branchFromSessionPath : undefined,
    branchFromSdkCwd: fork ? product.branchFromSdkCwd : undefined,
    branchFromSdkTurnId: fork ? product.branchFromSdkTurnId : undefined,
    branchFromMessageId: product.branchFromMessageId,
    createdAt: product.createdAt, lastUsedAt: product.lastUsedAt,
    workingDirectory: product.workingDirectory, sdkCwd: product.sdkCwd,
    model: product.model, llmConnection: product.llmConnection,
    permissionMode: product.permissionMode, previousPermissionMode: product.previousPermissionMode,
    projectId: product.projectId, activePlugin: product.activePlugin,
  }
}

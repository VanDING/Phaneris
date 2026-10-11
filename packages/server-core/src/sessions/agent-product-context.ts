/** Product configuration snapshot. Runtime execution state is never an input. */
import type { CoreBackendConfig } from '@phaneris/shared/agent/backend'

type AgentSessionConfig = NonNullable<CoreBackendConfig['session']>
export type AgentProductContext = AgentSessionConfig & { readonly branchContextStrategy?: string }

export function buildAgentSessionSnapshot(product: Readonly<AgentProductContext>): AgentSessionConfig {
  const fork = product.branchContextStrategy === 'sdk-fork'
  return {
    id: product.id, workspaceRootPath: product.workspaceRootPath, sdkSessionId: product.sdkSessionId,
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

/** Backend construction only. The caller installs the driver on the existing Runtime Host. */
import { createBackendFromResolvedContext, type ResolvedBackendContext } from '@phaneris/shared/agent/backend'
import type { AgentBackend, BackendHostRuntimeContext, CoreBackendConfig } from '@phaneris/shared/agent/backend'

type CallbackKey = 'onSdkSessionIdUpdate' | 'onSdkSessionIdCleared' | 'onBranchForkInvalidated'
  | 'onThinkingLevelStateUpdate' | 'getRecoveryMessages' | 'getBranchFallbackMessages'
  | 'getBranchSeedMessages' | 'markBranchSeedApplied' | 'getTransferredSessionSummary'
  | 'markTransferredSessionSummaryApplied' | 'onImageResize'
type ResourceKey = 'mcpPool' | 'poolServerUrl' | 'automationSystem' | 'initialSources'
  | 'durableToolBoundary' | 'durableModelBoundary' | 'getCanonicalModelContext'
  | 'beginDurableUtilityRun' | 'completeDurableUtilityRun'
export type SessionAgentCallbacks = Pick<CoreBackendConfig, CallbackKey>
export type SessionAgentResources = Pick<CoreBackendConfig, ResourceKey>
export type SessionAgentConfiguration = Omit<CoreBackendConfig, CallbackKey | ResourceKey>
export interface SessionAgentAssembly {
  readonly context: Readonly<ResolvedBackendContext>
  readonly hostRuntime: Readonly<BackendHostRuntimeContext>
  readonly config: Readonly<SessionAgentConfiguration>
  readonly callbacks: Readonly<SessionAgentCallbacks>
  readonly resources: Readonly<SessionAgentResources>
  readonly providerOptions?: Readonly<{ piAuthProvider?: string }>
}

/** Copy product data at the boundary; resource handles and callback ports retain their owners. */
export function prepareSessionAgentAssembly(input: SessionAgentAssembly): SessionAgentAssembly {
  if (!input.config.workspace.rootPath || !input.context.resolvedModel) throw new Error('Session assembly requires workspace and resolved model')
  if (input.config.session && input.config.session.workspaceRootPath !== input.config.workspace.rootPath) {
    throw new Error('Session assembly workspace mismatch')
  }
  return Object.freeze({
    context: Object.freeze({ ...input.context, capabilities: Object.freeze({ ...input.context.capabilities }),
      connection: input.context.connection ? { ...input.context.connection,
        models: input.context.connection.models?.map(model => typeof model === 'string' ? model : { ...model }),
        customEndpoint: input.context.connection.customEndpoint ? { ...input.context.connection.customEndpoint } : undefined,
      } : null }),
    hostRuntime: Object.freeze({ ...input.hostRuntime }),
    config: Object.freeze({ ...input.config, workspace: Object.freeze({ ...input.config.workspace }),
      session: input.config.session ? Object.freeze({ ...input.config.session }) : undefined,
      envOverrides: input.config.envOverrides ? Object.freeze({ ...input.config.envOverrides }) : undefined }),
    callbacks: Object.freeze({ ...input.callbacks }),
    resources: Object.freeze({ ...input.resources }),
    providerOptions: input.providerOptions ? Object.freeze({ ...input.providerOptions }) : undefined,
  })
}

export function assembleSessionAgent(input: SessionAgentAssembly): AgentBackend {
  const snapshot = prepareSessionAgentAssembly(input)
  return createBackendFromResolvedContext({ context: snapshot.context, hostRuntime: snapshot.hostRuntime,
    providerOptions: snapshot.providerOptions,
    coreConfig: { ...snapshot.config, workspace: { ...snapshot.config.workspace },
      session: snapshot.config.session ? { ...snapshot.config.session } : undefined,
      envOverrides: snapshot.config.envOverrides ? { ...snapshot.config.envOverrides } : undefined,
      ...snapshot.callbacks, ...snapshot.resources } })
}

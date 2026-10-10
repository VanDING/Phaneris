import { AbortReason, type AgentBackend, type CoreBackendConfig, type ChatOptions } from '@phaneris/shared/agent/backend'
import type { FileAttachment } from '@phaneris/shared/utils'
import type { Message } from '@phaneris/core/types'
import { reportLegacyProjectionParity } from './projection-audit.js'
import type { DurableRuntime, RuntimeDriver, RuntimeInputReceipt, RuntimeExecutionHandle, RuntimeScope } from '../durable-runtime/index.js'

export interface PiDriverInput { message: string; attachments?: FileAttachment[]; options?: ChatOptions; beforeRun?: () => void }
const EXECUTION_METHODS = new Set(['chat', 'redirect', 'redirectConfirmed', 'forceAbort', 'interruptForHandoff', 'destroy', 'dispose', 'disposeForRestart'])
export type PiAgentControls = Omit<AgentBackend, 'chat' | 'redirect' | 'redirectConfirmed' | 'forceAbort' | 'interruptForHandoff' | 'destroy' | 'dispose' | 'disposeForRestart'>
export class PiRuntimeDriver implements RuntimeDriver {
  readonly controls: PiAgentControls
  private disposal?: Promise<void>
  constructor(private readonly backend: AgentBackend, private readonly releaseResources?: () => Promise<void>) {
    this.controls = new Proxy(backend, {
      get(target, key) {
        if (EXECUTION_METHODS.has(String(key))) return undefined
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
      set(target, key, value) {
        if (EXECUTION_METHODS.has(String(key))) throw new Error('Execution is owned by Runtime Host')
        return Reflect.set(target, key, value, target)
      },
    })
  }
  run(input: unknown, context: RuntimeExecutionHandle & { operationId: string; turnId: string }) {
    const request = input as PiDriverInput
    const iterator = this.backend.chat(request.message, request.attachments, { ...request.options,
      durableRunOperationId: context.operationId, durableTurnId: context.turnId })
    request.beforeRun?.()
    return iterator
  }
  stop(reason: string) {
    if (reason === AbortReason.PlanSubmitted || reason === AbortReason.AuthRequest) this.backend.interruptForHandoff?.(reason)
    else this.backend.forceAbort?.(reason as AbortReason)
  }
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      try {
        try {
          if (this.backend.disposeForRestart) await this.backend.disposeForRestart()
          else this.backend.dispose?.()
        } finally { this.backend.destroy?.() }
      } finally { await this.releaseResources?.() }
    })()
  }
  async steer(input: unknown): Promise<RuntimeInputReceipt> {
    const request = input as PiDriverInput
    if (this.backend.redirectConfirmed) {
      const receipt = await this.backend.redirectConfirmed(request.message, request.options?.inputId ?? '')
      return receipt
    }
    return { disposition: this.backend.redirect(request.message) ? 'handled' : 'rejected' }
  }
}

type RuntimeConfig = Pick<CoreBackendConfig, 'durableToolBoundary' | 'durableModelBoundary' | 'getCanonicalModelContext' | 'beginDurableUtilityRun' | 'completeDurableUtilityRun'>
/** Protocol binding receives an explicit compatibility read port, never a product session object. */
export function bindPiRuntime(runtime: DurableRuntime, scope: RuntimeScope, options: {
  compatibilityMessages?: () => readonly Message[]
  auxiliarySettled?: () => void
  observerError?: (error: unknown) => void
} = {}): RuntimeConfig {
  const notify = () => { try { options.auxiliarySettled?.() } catch (error) { options.observerError?.(error) } }
  const { workspaceRootPath: workspace, sessionId } = scope
  const utilityLeases = new Map<string, () => void>()
  return {
    durableToolBoundary: runtime.effects.boundaryFor(workspace),
    durableModelBoundary: { ...runtime.effects.modelBoundaryFor(workspace), commitOutcome: async request => {
      const result = await runtime.effects.commitModelOutcome(workspace, request)
      if (request.purpose === 'cache_warm') notify()
      return result
    } },
    getCanonicalModelContext: excludeOperationId => {
      if (options.compatibilityMessages) {
        const parity = reportLegacyProjectionParity(runtime.queries.events(workspace, { sessionId }), [...options.compatibilityMessages()])
        if (!parity.canonicalFacts || parity.issueCount) return undefined
      }
      return runtime.queries.getCanonicalModelContext(workspace, sessionId, excludeOperationId)
    },
    beginDurableUtilityRun: ({ requestId, prompt }) => {
      const operationId = `utility:${sessionId}:${requestId}:${Date.now()}`
      const release = runtime.effects.retainAuxiliary()
      try {
        runtime.commands.acceptRun({ ...scope, operationId, turnId: operationId,
          userMessageId: `${operationId}:input`, userMessage: prompt, kind: 'system', modelVisible: false })
        utilityLeases.set(operationId, release)
      } catch (error) { release(); throw error }
      return { runOperationId: operationId, turnId: operationId }
    },
    completeDurableUtilityRun: (operationId, reason) => {
      try { runtime.commands.completeRun(workspace, operationId, reason); notify() }
      finally { utilityLeases.get(operationId)?.(); utilityLeases.delete(operationId) }
    },
  }
}

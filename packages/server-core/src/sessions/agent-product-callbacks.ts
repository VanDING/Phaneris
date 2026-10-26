/** Product state transitions behind finite ports; no Manager or Host execution access. */
import type { ThinkingLevel } from '@phaneris/shared/agent/thinking-levels'
import type { SessionAgentCallbacks } from './agent-assembly'
import type { SessionTaskContext } from '@phaneris/shared/sessions'
import { buildSessionTaskContext } from './agent-product-context'
import { projectTaskContinuity, type TaskInput, type TaskArtifact } from '@phaneris/shared/agent/task-continuity'

export interface AgentProductView extends SessionTaskContext {
  readonly id: string
  readonly sdkSessionId?: string
  readonly branchFromSdkSessionId?: string
  readonly branchFromSdkCwd?: string
  readonly branchFromSdkTurnId?: string
  readonly branchFromMessageId?: string
  readonly branchContextStrategy?: string
  readonly branchSeedApplied?: boolean
  readonly transferredSessionSummary?: string
  readonly transferredSessionSummaryApplied?: boolean
  readonly thinkingLevel?: ThinkingLevel
  readonly messages: readonly TaskInput[]
}
type ProductPatch = Partial<Pick<AgentProductView, 'sdkSessionId' | 'branchFromSdkSessionId' | 'branchFromSdkCwd'
  | 'branchFromSdkTurnId' | 'branchSeedApplied' | 'transferredSessionSummaryApplied' | 'thinkingLevel'>>
export interface AgentProductPorts {
  read(): AgentProductView
  patch(changes: ProductPatch): void
  persist(): void
  flush(): Promise<void>
  thinkingChanged(level: ThinkingLevel): void
  log(message: string, details?: unknown): void
  error(message: string, error: unknown): void
  artifacts?(): readonly TaskArtifact[]
}

export function createSessionAgentCallbacks(ports: AgentProductPorts): Omit<SessionAgentCallbacks, 'onImageResize'> {
  const persistAndFlush = () => {
    ports.persist()
    void ports.flush().catch(error => ports.error(`Failed to persist session ${ports.read().id}:`, error))
  }
  const messages = (view: AgentProductView) => view.messages
    .filter(message => (message.role === 'user' || message.role === 'assistant') && !message.isIntermediate)
    .map(message => ({ type: message.role as 'user' | 'assistant', content: message.content }))
  return {
    getSessionTaskContext: () => buildSessionTaskContext(ports.read()),
    getTaskContinuityContext: budget => projectTaskContinuity({ task: buildSessionTaskContext(ports.read()),
      messages: ports.read().messages, artifacts: ports.artifacts?.() }, budget),
    onSdkSessionIdUpdate(sdkSessionId) {
      const view = ports.read()
      ports.patch({ sdkSessionId, ...(view.branchFromSdkSessionId ? {
        branchFromSdkSessionId: undefined, branchFromSdkCwd: undefined, branchFromSdkTurnId: undefined,
      } : {}) })
      ports.log(view.branchFromSdkSessionId
        ? `Branch fork established for ${view.id}: child=${sdkSessionId}, retiring parent fork metadata (parent=${view.branchFromSdkSessionId})`
        : `SDK session ID captured for ${view.id}: ${sdkSessionId}`)
      persistAndFlush()
    },
    onSdkSessionIdCleared() {
      ports.patch({ sdkSessionId: undefined })
      ports.log(`SDK session ID cleared for ${ports.read().id} (resume recovery)`)
      persistAndFlush()
    },
    onBranchForkInvalidated() {
      ports.patch({ sdkSessionId: undefined, branchFromSdkSessionId: undefined,
        branchFromSdkCwd: undefined, branchFromSdkTurnId: undefined })
      ports.log(`Branch fork invalidated for ${ports.read().id}: cleared all fork metadata`)
      persistAndFlush()
    },
    onThinkingLevelStateUpdate({ effectiveLevel }) {
      if (ports.read().thinkingLevel === effectiveLevel) return
      ports.patch({ thinkingLevel: effectiveLevel })
      ports.persist()
      ports.thinkingChanged(effectiveLevel)
      ports.log(`Session ${ports.read().id}: Pi clamped thinking level to ${effectiveLevel}`)
    },
    getRecoveryMessages: () => {
      const all = messages(ports.read())
      const goal = all.find(message => message.type === 'user')
      const accepted = all.findLast(message => message.type === 'user' && message.content.includes('Accepted plan message:') && /Content (?:sha256|revision):/.test(message.content))
      const selected = new Set([goal, accepted, ...all.slice(-6)])
      return all.filter(message => selected.has(message)).map(message => ({ ...message,
        ...((message === goal || message === accepted) ? { preserveContent: true } : {}) }))
    },
    getBranchFallbackMessages() {
      const view = ports.read()
      return view.branchFromMessageId ? messages(view) : []
    },
    getBranchSeedMessages() {
      const view = ports.read()
      return view.branchContextStrategy === 'seeded-fresh-session' && !view.branchSeedApplied ? messages(view) : []
    },
    markBranchSeedApplied() {
      const view = ports.read()
      if (view.branchContextStrategy !== 'seeded-fresh-session' || view.branchSeedApplied) return
      ports.patch({ branchSeedApplied: true })
      ports.log('Branch seed context applied', { sessionId: view.id, strategy: view.branchContextStrategy })
    },
    getTransferredSessionSummary() {
      const view = ports.read()
      const summary = view.transferredSessionSummaryApplied ? null : (view.transferredSessionSummary ?? null)
      ports.log(`[transfer-context] getTransferredSessionSummary for ${view.id}: applied=${view.transferredSessionSummaryApplied}, has_summary=${!!view.transferredSessionSummary}, returning=${summary ? `${summary.length} chars` : 'null'}`)
      return summary
    },
    markTransferredSessionSummaryApplied() {
      const view = ports.read()
      if (view.transferredSessionSummaryApplied || !view.transferredSessionSummary) return
      ports.patch({ transferredSessionSummaryApplied: true })
      ports.persist()
      ports.log('Transferred session summary applied', { sessionId: view.id })
    },
  }
}

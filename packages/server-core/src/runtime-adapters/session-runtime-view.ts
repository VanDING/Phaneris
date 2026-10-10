import type { StoredAttachment } from '@phaneris/core/types'
import type { FileAttachment } from '@phaneris/shared/utils'
import type { SendMessageOptions } from '@phaneris/shared/protocol'
import type { DecisionPointTrace } from '@phaneris/shared/decisions'
import type { DurableRuntime } from '../durable-runtime/index.js'
import { PiRuntimeDriver, type PiAgentControls } from './pi-driver.js'

export interface QueuedSessionInput {
  message: string; attachments?: FileAttachment[]; storedAttachments?: StoredAttachment[]; options?: SendMessageOptions
  messageId?: string; optimisticMessageId?: string; mergeWith?: object; mergeDecision?: DecisionPointTrace; continuationCheck?: Promise<void>
}
export interface SessionRuntimeView {
  readonly agent: PiAgentControls | null
  readonly isProcessing: boolean
  readonly stopRequested: boolean
  readonly processingGeneration: number
  readonly activeDurableRunOperationId?: string
  readonly messageQueue: readonly QueuedSessionInput[]
}
export const DISCONNECTED_RUNTIME_VIEW: SessionRuntimeView = Object.freeze({ agent: null, isProcessing: false,
  stopRequested: false, processingGeneration: 0, messageQueue: Object.freeze([]) })

/** A live, read-only product projection of the Host, with no mutable state copy. */
export function sessionRuntimeView(runtime: DurableRuntime, sessionId: string): SessionRuntimeView {
  const view = runtime.execution.view(sessionId)
  return Object.freeze({
    get agent() { return view.driver instanceof PiRuntimeDriver ? view.driver.controls : null },
    get isProcessing() { return view.isProcessing }, get stopRequested() { return view.stopRequested },
    get processingGeneration() { return view.generation }, get activeDurableRunOperationId() { return view.activeRunOperationId },
    get messageQueue() { return runtime.execution.queued<QueuedSessionInput>(sessionId) },
  })
}

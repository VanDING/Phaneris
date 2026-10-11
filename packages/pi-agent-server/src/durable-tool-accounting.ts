/** Sole owner of transport-side tool batch and committed boundary metadata. */
export interface ToolBatch { readonly toolBatchId: string; readonly toolBatchOrdinal: number }
export interface ToolCommit { readonly operationId: string; readonly startSeq: number; readonly outcomeSeq?: number }
export class DurableToolAccounting {
  private readonly batches = new Map<string, ToolBatch>()
  private readonly commits = new Map<string, ToolCommit>()
  rememberBatch(toolCalls: readonly { readonly id: string }[], toolBatchId: string): void {
    toolCalls.forEach((call, toolBatchOrdinal) => this.batches.set(call.id, Object.freeze({ toolBatchId, toolBatchOrdinal })))
  }
  rememberNestedBatch(toolCallId: string, parentToolCallId: string): void {
    const ordinal = Number(toolCallId.slice(toolCallId.lastIndexOf('/') + 1))
    if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error('SDK nested tool ordinal is unavailable')
    this.batches.set(toolCallId, Object.freeze({ toolBatchId: parentToolCallId, toolBatchOrdinal: ordinal }))
  }
  readBatch(toolCallId: string): ToolBatch | undefined { return this.batches.get(toolCallId) }
  rememberCommit(toolCallId: string, commit: ToolCommit): void { this.commits.set(toolCallId, Object.freeze({ ...commit })) }
  readCommit(toolCallId: string): ToolCommit | undefined { return this.commits.get(toolCallId) }
  finishTool(toolCallId: string): void { this.commits.delete(toolCallId); this.batches.delete(toolCallId) }
  resetBatches(): void { this.batches.clear() }
}
export type ToolEventAccounting = Pick<DurableToolAccounting, 'rememberNestedBatch' | 'readCommit' | 'finishTool' | 'resetBatches'>

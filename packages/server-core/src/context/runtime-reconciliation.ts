import type { ResidentContextState } from '@phaneris/session-tools-core/resident-context-contracts'
import type { ToolReconciliationAdapter } from '@phaneris/shared/durable-runtime/types'

/** Read committed local command evidence only. Absence never proves no effect. */
export function contextReconciliationAdapter(readReceipt: (operationId: string) => ResidentContextState | undefined): ToolReconciliationAdapter {
  return { async queryExternal(input) {
    const receipt = readReceipt(input.operationId)
    if (!receipt) throw new Error(`effect_outcome_unknown: No committed context command receipt for ${input.operationId}; inspect original evidence, do not replay it`)
    return { decision: 'completed', reason: 'The context owner durably recorded this exact tool operation',
      evidence: [{ source: 'other', summary: 'Atomic context command receipt', observedAt: Date.now(),
        externalReference: `context-operation:${input.operationId}` }],
      result: { content: [{ type: 'text', text: JSON.stringify(receipt) }] } }
  } }
}

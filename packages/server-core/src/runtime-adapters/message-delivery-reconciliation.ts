import type { ToolReconciliationAdapter } from '@phaneris/shared/durable-runtime'

/** Only an exact, operation-linked target admission proves this delivery happened. */
export function createMessageDeliveryReconciliationAdapter(
  receiptFor: (targetSessionId: string, messageId: string) => { messageId: string } | undefined,
): ToolReconciliationAdapter {
  return {
    queryExternal: async ({ operationId, args }) => {
      const targetSessionId = typeof args?.sessionId === 'string' ? args.sessionId : undefined
      if (!targetSessionId) throw new Error('Message delivery has no canonical target session')
      const receipt = receiptFor(targetSessionId, `agent-message:${operationId}`)
      if (!receipt) throw new Error('No exact durable delivery receipt exists; the message will not be replayed')
      const externalReference = `${targetSessionId}/${receipt.messageId}`
      return {
        decision: 'completed',
        reason: 'The target Runtime committed the input admission linked to this send operation',
        evidence: [{ source: 'provider_receipt', summary: `Target session ${targetSessionId} durably accepted ${receipt.messageId}`, observedAt: Date.now(), externalReference }],
        result: { content: [{ type: 'text', text: `Message accepted by session ${targetSessionId}; processing continues independently.` }] },
        externalReference,
      }
    },
  }
}

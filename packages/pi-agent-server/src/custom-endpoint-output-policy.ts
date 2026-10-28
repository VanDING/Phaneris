import type { StreamFn } from '@earendil-works/pi-agent-core'

/** Let an arbitrary Chat Completions server own its default output budget.
 * Explicit call_llm, compaction, handoff and cache-warming limits still apply.
 * Wrap outside accounting so the recorded payload is the payload actually sent.
 */
export function withCustomEndpointOutputPolicy(stream: StreamFn): StreamFn {
  return (model, context, options) => {
    if (model.provider !== 'custom-endpoint' || model.api !== 'openai-completions' || options?.maxTokens !== undefined) {
      return stream(model, context, options)
    }
    return stream(model, context, {
      ...options,
      onPayload: async (payload, selectedModel) => {
        const replacement = await options?.onPayload?.(payload, selectedModel)
        const effective = replacement === undefined ? payload : replacement
        if (!effective || typeof effective !== 'object' || Array.isArray(effective)) return replacement
        const { max_tokens: _tokens, max_completion_tokens: _completionTokens, ...body } = effective as Record<string, unknown>
        return body
      },
    })
  }
}

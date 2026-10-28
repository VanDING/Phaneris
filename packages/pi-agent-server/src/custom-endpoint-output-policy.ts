import type { StreamFn } from '@earendil-works/pi-agent-core'

/** Let an arbitrary Chat Completions server own its default output budget.
 * Explicit call_llm, compaction, handoff and cache-warming limits still apply.
 * Wrap outside accounting so the recorded payload is the payload actually sent.
 */
export function withCustomEndpointOutputPolicy(stream: StreamFn): StreamFn {
  return (model, context, options) => {
    if (model.provider !== 'custom-endpoint' || model.api !== 'openai-completions') {
      return stream(model, context, options)
    }
    if (options?.maxTokens !== undefined) {
      // Warming inherits the earlier run's onPayload callback, including our
      // removal of SDK defaults. Preserve this new request's explicit budget
      // even when that inherited callback removes its field.
      return stream(model, context, { ...options, onPayload: async (payload, selectedModel) => {
        const original = payload as Record<string, unknown>
        const replacement = await options.onPayload?.(payload, selectedModel)
        const effective = (replacement === undefined ? payload : replacement) as Record<string, unknown>
        const key = 'max_completion_tokens' in original ? 'max_completion_tokens' : 'max_tokens'
        return key in original && !(key in effective) ? { ...effective, [key]: original[key] } : replacement
      } })
    }
    const original = options?.onPayload
    return stream(model, context, { ...options, onPayload: async (payload, selectedModel) => {
        const replacement = await original?.(payload, selectedModel)
        const effective = replacement === undefined ? payload : replacement
        if (!effective || typeof effective !== 'object' || Array.isArray(effective)) return replacement
        const { max_tokens: _tokens, max_completion_tokens: _completionTokens, ...body } = effective as Record<string, unknown>
        return body
      } })
  }
}

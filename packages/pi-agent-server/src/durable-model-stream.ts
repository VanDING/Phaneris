import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, CacheRetention } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { observeNativeRequest } from './native-request-observation.ts';
import type { NativeRequestObservation } from '../../shared/src/durable-runtime/types.ts';

/** Wrap the session's actual stream, preserving SDK authentication and retry options. */
export function wrapDurableModelStream(
  stream: StreamFn,
  prepare: (
    model: Parameters<StreamFn>[0],
    context: Parameters<StreamFn>[1],
    observation?: NativeRequestObservation,
  ) => Promise<(message: AssistantMessage) => Promise<void>>,
  /**
   * Optional default retention for requests that do not set one explicitly.
   * Explicit values (notably compaction's 'none') are preserved.
   */
  resolveDefaultCacheRetention?: () => CacheRetention,
): StreamFn {
  return (model, context, options) => {
    const effectiveOptions = resolveDefaultCacheRetention && options?.cacheRetention === undefined
      ? { ...options, cacheRetention: resolveDefaultCacheRetention() }
      : options;
    const target = createAssistantMessageEventStream();
    void (async () => {
      try {
        const observed = observeNativeRequest(effectiveOptions);
        const commit = await prepare(model, context, observed.observation);
        if (effectiveOptions?.signal?.aborted) {
          // T1 may wait for the host while warming is disabled or the run ends.
          // No provider call has occurred, so a zero-usage cancellation is known.
          const aborted: AssistantMessage = {
            role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'aborted', timestamp: Date.now(),
          };
          await commit(aborted);
          target.push({ type: 'error', reason: 'aborted', error: aborted });
          return;
        }
        const source = await stream(model, context, observed.options);
        for await (const event of source) {
          if (event.type === 'done' || event.type === 'error') {
            // Commit metered partial/error responses as well as successful ones.
            await commit(event.type === 'done' ? event.message : event.error);
          }
          target.push(event);
        }
      } catch (error) {
        const failed: AssistantMessage = {
          role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'error', errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        };
        // A thrown stream/commit does not prove the provider had no effect.
        // Keep an existing T1 pending for recovery; the UI error is not a ledger outcome.
        target.push({ type: 'error', reason: 'error', error: failed });
      }
    })();
    return target;
  };
}

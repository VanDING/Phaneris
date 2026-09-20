import { normalizeContext } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { StreamFn } from '@earendil-works/pi-agent-core';

/**
 * Pi 0.86.1 sends warming directly through ModelRuntime.streamSimple, outside
 * its agent stream. The SDK invokes the runtime synchronously from its agent
 * stream; a synchronous guard distinguishes even one-token ordinary requests
 * without leaking an AsyncLocalStorage marker into the warmer's timer.
 * The real-SDK integration test protects this routing contract on upgrades.
 */
export function installCacheWarmingAccounting(
  runtime: Pick<ModelRuntime, 'streamSimple'>,
  sessionStream: StreamFn,
  wrapWarmStream: (stream: StreamFn) => StreamFn,
): StreamFn {
  const original = runtime.streamSimple.bind(runtime);
  const warm = wrapWarmStream(original);
  let sessionDispatch = false;
  runtime.streamSimple = (model, context, options) => {
    if (!sessionDispatch && options?.maxTokens === 1 && options.maxRetries === 0) {
      // StreamFn permits a promise, whereas ModelRuntime returns a stream.
      // Our accounting wrapper always returns a stream synchronously.
      return warm(model, normalizeContext(context), options) as ReturnType<ModelRuntime['streamSimple']>;
    }
    return original(model, context, options);
  };
  return (model, context, options) => {
    sessionDispatch = true;
    try {
      return sessionStream(model, context, options);
    } finally {
      sessionDispatch = false;
    }
  };
}

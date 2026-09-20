import { createHash } from 'node:crypto';
import type { SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { NativeRequestObservation } from '../../shared/src/durable-runtime/types.ts';

/** SDK callback observations, not a count of network attempts or wire bytes. */
export function observeNativeRequest(options: SimpleStreamOptions = {}): {
  options: SimpleStreamOptions;
  observation: NativeRequestObservation;
} {
  const observation: NativeRequestObservation = {
    version: 1,
    source: 'pi_native_callbacks',
    sdkSessionId: options.sessionId,
    payloads: [],
    responses: [],
    payloadCallbackCount: 0,
    responseCallbackCount: 0,
    droppedObservations: 0,
    observationErrors: 0,
  };
  // Deliberately omit credentials, metadata, arbitrary sampling values and content.
  const configuration: Record<string, string | number | boolean> = {};
  for (const key of ['cacheRetention', 'transport', 'reasoning', 'temperature', 'maxTokens',
    'maxRetries', 'maxRetryDelayMs', 'timeoutMs', 'websocketConnectTimeoutMs'] as const) {
    const value = options[key];
    if (typeof value === 'string' || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))) configuration[key] = value;
  }
  observation.requestedOptions = configuration;
  return {
    observation,
    options: {
      ...options,
      onPayload: async (payload, model) => {
        // Observe AFTER existing SDK extensions have replaced/mutated the payload.
        const replacement = await options.onPayload?.(payload, model);
        const effectivePayload = replacement === undefined ? payload : replacement;
        observation.payloadCallbackCount++;
        try {
          if (observation.payloads.length < 32) {
            const serialized = JSON.stringify(effectivePayload);
            if (serialized === undefined) throw new Error('Non-JSON payload');
            observation.payloads.push({
              ordinal: observation.payloadCallbackCount,
              capturedAt: Date.now(),
              hash: createHash('sha256').update(serialized).digest('hex'),
              bytes: Buffer.byteLength(serialized),
            });
          } else observation.droppedObservations++;
        } catch { observation.observationErrors++; }
        return replacement;
      },
      onResponse: async (response, model) => {
        observation.responseCallbackCount++;
        try {
          if (observation.responses.length < 32) {
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(response.headers)) {
              const key = name.toLowerCase();
              // No cookies, authorization, arbitrary headers, or response bodies.
              if (['request-id', 'x-request-id', 'x-amzn-requestid', 'retry-after',
                'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens'].includes(key)) {
                headers[key] = String(value).slice(0, 256);
              }
            }
            observation.responses.push({
              ordinal: observation.responseCallbackCount, capturedAt: Date.now(),
              status: response.status, headers,
            });
          } else observation.droppedObservations++;
        } catch { observation.observationErrors++; }
        await options.onResponse?.(response, model);
      },
    },
  };
}

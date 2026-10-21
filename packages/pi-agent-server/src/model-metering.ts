import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { NativeRequestObservation } from '@phaneris/shared/durable-runtime/types';

export interface ModelMeteringEvidence {
  version: 1;
  status: 'reported' | 'sdk' | 'partial' | 'unavailable' | 'not_dispatched';
  source: 'provider_stream' | 'pi_sdk' | 'local_dispatch_guard';
  inputKnown: boolean;
  outputKnown: boolean;
}

type MeteredMessage = AssistantMessage & { modelMetering?: ModelMeteringEvidence };
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Observe only field presence. Never persist content, credentials or raw events. */
export function observeProviderMetering(data: unknown, observation: NativeRequestObservation): void {
  const event = object(data);
  if (!event) return;
  const observed = observation.providerUsage ??= { input: false, output: false };
  const candidates = [event.usage, event.usageMetadata, object(event.message)?.usage,
    object(event.response)?.usage, object(event.metadata)?.usage, object(event.data)?.usage,
    object(event.partial)?.usage, ...((Array.isArray(event.choices) ? event.choices : []).map(choice => object(choice)?.usage))];
  for (const value of candidates) {
    const usage = object(value);
    if (!usage) continue;
    if (['input', 'input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens', 'promptTokenCount'].some(key => count(usage[key]))) observed.input = true;
    if (['output', 'output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens', 'candidatesTokenCount'].some(key => count(usage[key]))) observed.output = true;
  }
}

/** SDK always initializes usage to zero, so object existence is not evidence. */
export function modelMetering(message: AssistantMessage, observation?: NativeRequestObservation): ModelMeteringEvidence {
  const existing = (message as MeteredMessage).modelMetering;
  if (existing) return existing;
  const fields = observation?.providerUsage;
  if (fields?.input || fields?.output) return {
    version: 1, status: fields.input && fields.output ? 'reported' : 'partial',
    source: 'provider_stream', inputKnown: fields.input, outputKnown: fields.output,
  };
  // Adapters without the raw callback can still report positive SDK buckets.
  // Unobserved zeros remain unknown, including on successful empty responses.
  const inputKnown = [message.usage.input, message.usage.cacheRead, message.usage.cacheWrite].some(value => count(value) && value > 0);
  const outputKnown = count(message.usage.output) && message.usage.output > 0;
  return { version: 1, status: inputKnown && outputKnown ? 'sdk' : inputKnown || outputKnown ? 'partial' : 'unavailable',
    source: 'pi_sdk', inputKnown, outputKnown };
}

export function attachModelMetering(message: AssistantMessage, observation: NativeRequestObservation, notDispatched = false): void {
  (message as MeteredMessage).modelMetering = notDispatched
    ? { version: 1, status: 'not_dispatched', source: 'local_dispatch_guard', inputKnown: true, outputKnown: true }
    : modelMetering(message, observation);
}

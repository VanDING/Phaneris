import type { AssistantMetrics } from '@phaneris/core/types';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { NativeRequestObservation } from '@phaneris/shared/durable-runtime/types';
import type { ModelMeteringEvidence } from './model-metering.ts';

/** Measured before durable commits and before compacting the host transport. */
export function createAssistantTiming() {
  let start: number | null = null, startEpoch: number | null = null;
  let output: number | null = null, outputEpoch: number | null = null;
  let text: number | null = null, textEpoch: number | null = null;
  return {
    dispatched() {
      if (start !== null) return;
      start = performance.now(); startEpoch = Date.now();
    },
    observe(event: AssistantMessageEvent) {
      const tool = event.type === 'toolcall_start' ? event.partial.content[event.contentIndex] : undefined;
      const toolOutput = tool?.type === 'toolCall' && !!tool.name;
      if (!toolOutput && ((event.type !== 'text_delta' && event.type !== 'thinking_delta' && event.type !== 'toolcall_delta') || !event.delta)) return;
      const now = performance.now(), epoch = Date.now();
      if (output === null) { output = now; outputEpoch = epoch; }
      if (event.type === 'text_delta' && text === null) { text = now; textEpoch = epoch; }
    },
    completed(message: AssistantMessage, observation: NativeRequestObservation): AssistantMetrics {
      const metering = (message as AssistantMessage & { modelMetering?: ModelMeteringEvidence }).modelMetering;
      const end = performance.now(), endEpoch = Date.now();
      const total = start === null ? null : end - start;
      const first = start === null || output === null ? null : output - start;
      const generation = output === null ? null : end - output;
      const reason: AssistantMetrics['timingUnavailableReason'] = message.stopReason === 'aborted' ? 'aborted'
        : message.stopReason === 'error' ? 'failed'
          : start === null ? 'start_unobserved'
            : observation.payloadCallbackCount > 1 || observation.responseCallbackCount > 1 ? 'multiple_attempts'
              : output === null ? 'no_output'
                : total! < 0 || first! < 0 || generation! < 0 ? 'invalid_interval' : undefined;
      return {
        timingVersion: 2, timingSource: 'pi_provider_callbacks', timingUnavailableReason: reason,
        timingRecorded: reason === undefined, stepStartTime: startEpoch,
        firstTokenTime: textEpoch, firstTextTime: textEpoch, firstOutputTime: outputEpoch, completedTime: endEpoch,
        requestDurationMs: total, firstOutputLatencyMs: first,
        firstTextLatencyMs: start === null || text === null ? null : text - start,
        generationDurationMs: generation, usageProvided: metering ? metering.status !== 'unavailable' : message.usage !== undefined,
        outputTokens: metering?.outputKnown === false ? null : typeof message.usage?.output === 'number' ? message.usage.output : null,
      };
    },
  };
}

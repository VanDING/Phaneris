import type { AssistantMetrics } from '../types/message.ts';

export type AssistantTimingUnavailableReason = NonNullable<AssistantMetrics['timingUnavailableReason']>
  | 'not_recorded' | 'legacy' | 'usage_missing' | 'generation_unavailable';

export interface AssistantTimingValues {
  totalMs: number | null;
  ttftMs: number | null;
  firstTextMs: number | null;
  generationMs: number | null;
  tokensPerSecond: number | null;
  legacyFirstTextMs: number | null;
  unavailableReason?: AssistantTimingUnavailableReason;
  rateUnavailableReason?: AssistantTimingUnavailableReason;
}

const duration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Old epoch differences never silently become v2 request latency or speed. */
export function readAssistantTiming(metrics: AssistantMetrics | undefined): AssistantTimingValues {
  const empty: AssistantTimingValues = { totalMs: null, ttftMs: null, firstTextMs: null,
    generationMs: null, tokensPerSecond: null, legacyFirstTextMs: null };
  if (!metrics) return { ...empty, unavailableReason: 'not_recorded', rateUnavailableReason: 'not_recorded' };
  if (metrics.timingVersion !== 2 || metrics.timingSource !== 'pi_provider_callbacks') {
    const legacy = typeof metrics.stepStartTime === 'number' && typeof metrics.firstTokenTime === 'number'
      ? metrics.firstTokenTime - metrics.stepStartTime : null;
    return { ...empty, legacyFirstTextMs: duration(legacy) ? legacy : null,
      unavailableReason: 'legacy', rateUnavailableReason: 'legacy' };
  }
  if (metrics.timingUnavailableReason) return { ...empty,
    unavailableReason: metrics.timingUnavailableReason, rateUnavailableReason: metrics.timingUnavailableReason };
  const total = metrics.requestDurationMs, first = metrics.firstOutputLatencyMs, generation = metrics.generationDurationMs;
  if (!metrics.timingRecorded || !duration(total) || !duration(first) || first > total
    || !duration(generation) || Math.abs(total - first - generation) > 1) {
    return { ...empty, unavailableReason: 'invalid_interval', rateUnavailableReason: 'invalid_interval' };
  }
  const text = metrics.firstTextLatencyMs;
  const output = metrics.outputTokens;
  const usage = metrics.usageProvided && typeof output === 'number' && Number.isFinite(output) && output > 0;
  // A sub-millisecond terminal burst measures SDK delivery overhead, not a
  // comparable generation window. Keep TTFT, but do not turn it into tok/s.
  const rate = usage && generation >= 1 ? output / (generation / 1000) : null;
  return { ...empty, totalMs: total, ttftMs: first, generationMs: generation,
    firstTextMs: duration(text) && text >= first && text <= total ? text : null,
    tokensPerSecond: rate !== null && Number.isFinite(rate) ? rate : null,
    rateUnavailableReason: !usage ? 'usage_missing' : rate === null || !Number.isFinite(rate) ? 'generation_unavailable' : undefined };
}

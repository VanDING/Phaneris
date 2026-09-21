/**
 * Occupancy transport through the Pi event adapter (#1043).
 *
 * The badge must show the SDK's own occupancy — never the billable `lastUsage`
 * — and every compaction boundary must replace or invalidate the old count
 * instead of leaving a frozen pre-compaction number.
 */
import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@phaneris/core/types';
import { PiEventAdapter } from '../backend/pi/event-adapter.ts';

type PiAdapterEvent = Parameters<PiEventAdapter['adaptEvent']>[0];

const settings = { enabled: true, reserveTokens: 31_000 };
const billing = { input: 400_000, output: 200, cacheRead: 19_000, cacheWrite: 50, totalTokens: 419_250, cost: { total: 2 } };

/** Fixtures are partial SDK event literals; each adapter case reads only its own fields. */
function adapt(adapter: PiEventAdapter, event: unknown): AgentEvent[] {
  // Unchecked cast: the SDK types demand fields (ids, timestamps) the adapter never touches.
  const sdkEvent = event as PiAdapterEvent;
  return [...adapter.adaptEvent(sdkEvent)];
}

describe('Pi canonical context occupancy', () => {
  it('uses SDK occupancy and resolved reserve rather than billing input', () => {
    const adapter = new PiEventAdapter();
    const events = adapt(adapter, {
      type: 'agent_end', messages: [], willRetry: false,
      contextUsage: { tokens: 42_000, contextWindow: 500_000 }, compactionSettings: settings,
    });
    expect(events).toMatchObject([
      { type: 'context_usage', contextUsage: {
        usedTokens: 42_000, limitTokens: 469_000, limitKind: 'compaction',
        isEstimate: true, isStale: false, canCompact: true,
      } },
      { type: 'complete' },
    ]);
  });

  it('transports a standalone post-message snapshot and preserves manual capability with auto disabled', () => {
    const adapter = new PiEventAdapter();
    const events = adapt(adapter, {
      type: 'context_usage', contextUsage: { tokens: 123, contextWindow: 500_000 },
      compactionSettings: { ...settings, enabled: false },
    });
    expect(events).toMatchObject([
      { type: 'context_usage', contextUsage: {
        usedTokens: 123, limitTokens: 500_000, limitKind: 'context', canCompact: true,
      } },
    ]);
  });

  it('uses fresh SDK compact estimate then unknown canonical usage, never resurrecting billable usage', () => {
    const adapter = new PiEventAdapter();
    adapt(adapter, { type: 'message_end', message: { role: 'assistant', content: [], usage: billing } });
    const compact = adapt(adapter, {
      type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false,
      result: { estimatedTokensAfter: 12_000 },
      contextUsage: { tokens: null, contextWindow: 500_000 }, compactionSettings: settings,
    });
    expect(compact).toMatchObject([
      { type: 'compaction_end', aborted: false },
      { type: 'context_usage', contextUsage: { usedTokens: 12_000, isStale: false } },
      { type: 'info' },
    ]);
    const end = adapt(adapter, {
      type: 'agent_end', messages: [], willRetry: false,
      contextUsage: { tokens: null, contextWindow: 500_000 }, compactionSettings: settings,
    });
    expect(end).toMatchObject([
      { type: 'context_usage', contextUsage: { usedTokens: null, isStale: true } },
      // Billing totals still ride the terminal event, but never as occupancy.
      { type: 'complete', usage: { inputTokens: 419_000, outputTokens: 200, costUsd: 2 } },
    ]);
  });

  it('invalidates old occupancy even when successful compaction has no SDK snapshot', () => {
    const adapter = new PiEventAdapter();
    adapt(adapter, {
      type: 'agent_end', messages: [], willRetry: false,
      contextUsage: { tokens: 419_000, contextWindow: 500_000 }, compactionSettings: settings,
    });
    const events = adapt(adapter, {
      type: 'compaction_end', reason: 'manual', result: {}, aborted: false, willRetry: false,
    });
    expect(events).toMatchObject([
      { type: 'compaction_end', reason: 'manual' },
      { type: 'context_usage', contextUsage: { usedTokens: null, isStale: true, limitTokens: 469_000 } },
      { type: 'info', message: 'Compacted context to fit within limits' },
    ]);
    // The pre-compaction number must not survive the boundary in any form.
    expect(JSON.stringify(events)).not.toContain('419000');
  });

  it('keeps the resolved limit but no stale count when the estimate arrives without SDK usage', () => {
    const adapter = new PiEventAdapter();
    adapt(adapter, {
      type: 'agent_end', messages: [], willRetry: false,
      contextUsage: { tokens: 419_000, contextWindow: 500_000 }, compactionSettings: settings,
    });
    const events = adapt(adapter, {
      type: 'compaction_end', reason: 'threshold', result: { estimatedTokensAfter: 12_000 }, aborted: false, willRetry: false,
    });
    expect(events).toMatchObject([
      { type: 'compaction_end' },
      { type: 'context_usage', contextUsage: {
        usedTokens: 12_000, limitTokens: 469_000, limitKind: 'compaction', isStale: false,
      } },
      { type: 'info' },
    ]);
  });

  it('leaves the count untouched when compaction was aborted before it ran', () => {
    const adapter = new PiEventAdapter();
    adapt(adapter, {
      type: 'agent_end', messages: [], willRetry: false,
      contextUsage: { tokens: 42_000, contextWindow: 500_000 }, compactionSettings: settings,
    });
    const events = adapt(adapter, {
      type: 'compaction_end', reason: 'threshold', result: undefined, aborted: true, willRetry: false,
    });
    // Nothing ran, so there is no new occupancy to report — and no error bubble.
    expect(events).toMatchObject([{ type: 'compaction_end', aborted: true }]);
  });
});

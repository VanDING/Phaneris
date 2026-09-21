import { describe, expect, it } from 'bun:test';
import type { PiContextUsagePayload } from '../../shared/src/agent/backend/pi/protocol.ts';
import { deferContextUsage, readContextUsage } from './context-usage.ts';

/** Exactly the SDK surface readContextUsage touches; the real class has no test double. */
type StubSession = {
  getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  settingsManager: { getCompactionSettings: () => { enabled: boolean; reserveTokens: number } };
};

function session(overrides: Partial<StubSession> = {}): Parameters<typeof readContextUsage>[0] {
  const stub: StubSession = {
    getContextUsage: () => ({ tokens: 42_000, contextWindow: 500_000, percent: 8.4 }),
    settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 31_000 }) },
    ...overrides,
  };
  // Unchecked cast: SettingsManager's private members make the stub nominally incompatible.
  return stub as unknown as Parameters<typeof readContextUsage>[0];
}

describe('Pi server context usage transport', () => {
  it('reads raw SDK usage and real compaction settings without normalizing in subprocess', () => {
    expect(readContextUsage(session())).toEqual({
      contextUsage: { tokens: 42_000, contextWindow: 500_000, percent: 8.4 },
      compactionSettings: { enabled: true, reserveTokens: 31_000 },
    });
  });

  it('fails soft when SDK usage is unavailable but still carries settings', () => {
    expect(readContextUsage(session({ getContextUsage: () => { throw new Error('not ready'); } }))).toEqual({
      compactionSettings: { enabled: true, reserveTokens: 31_000 },
    });
  });

  it('fails soft when compaction settings are unavailable but still carries usage', () => {
    expect(readContextUsage(session({
      settingsManager: { getCompactionSettings: () => { throw new Error('no settings'); } },
    }))).toEqual({
      contextUsage: { tokens: 42_000, contextWindow: 500_000, percent: 8.4 },
    });
  });

  it('guards deferred post-message reads against stale session replacement', async () => {
    const first = session();
    const second = session({ getContextUsage: () => ({ tokens: 1, contextWindow: 2, percent: 50 }) });
    const emitted: PiContextUsagePayload[] = [];
    deferContextUsage(first, () => second, payload => emitted.push(payload));
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });

  it('emits the committed read for the live session after the microtask', async () => {
    const live = session();
    const emitted: PiContextUsagePayload[] = [];
    deferContextUsage(live, () => live, payload => emitted.push(payload));
    expect(emitted).toEqual([]);
    await Promise.resolve();
    expect(emitted).toEqual([{
      contextUsage: { tokens: 42_000, contextWindow: 500_000, percent: 8.4 },
      compactionSettings: { enabled: true, reserveTokens: 31_000 },
    }]);
  });
});

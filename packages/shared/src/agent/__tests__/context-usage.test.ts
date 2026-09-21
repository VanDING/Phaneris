import { describe, expect, it } from 'bun:test';
import type { ContextUsageSnapshot } from '@phaneris/core/types';
import { contextAfterCompaction, contextFromPi } from '../context-usage.ts';

/** A resolved pre-compaction snapshot, as the adapter would have cached it. */
const before: ContextUsageSnapshot = {
  usedTokens: 419_000, limitTokens: 1_000_000, limitKind: 'compaction',
  isEstimate: true, isStale: false, canCompact: true,
};

describe('context occupancy snapshots', () => {
  it('replaces 419k with post-compaction 12k while retaining the resolved limit', () => {
    expect(contextAfterCompaction(12_000, before)).toEqual({
      usedTokens: 12_000, limitTokens: 1_000_000, limitKind: 'compaction', isEstimate: true, isStale: false, canCompact: true,
    });
  });

  it('invalidates the old count when compaction has no post-token metadata', () => {
    expect(contextAfterCompaction(undefined, before)).toMatchObject({ usedTokens: null, isStale: true, limitTokens: 1_000_000 });
    expect(contextAfterCompaction(Number.NaN, before).usedTokens).toBeNull();
    expect(contextAfterCompaction(0, before)).toMatchObject({ usedTokens: 0, isStale: false });
  });

  it('never resurfaces the pre-compaction usedTokens when the estimate is absent', () => {
    const stale = contextAfterCompaction(undefined, before);
    expect(stale.usedTokens).not.toBe(before.usedTokens);
    expect(contextAfterCompaction(undefined).usedTokens).toBeNull();
  });

  it('uses Pi SDK token estimates and the actual configured reserve', () => {
    expect(contextFromPi({ tokens: 120_000, contextWindow: 200_000 }, { enabled: true, reserveTokens: 16_384 })).toEqual({
      usedTokens: 120_000, limitTokens: 183_616, limitKind: 'compaction', isEstimate: true, isStale: false, canCompact: true,
    });
    expect(contextFromPi({ tokens: 120_000, contextWindow: 200_000 }, { enabled: true, reserveTokens: 20_000 })?.limitTokens).toBe(180_000);
  });

  it('preserves Pi unknown-after-compaction state, or uses a supplied fresh estimate', () => {
    const raw = { tokens: null, contextWindow: 200_000 };
    expect(contextFromPi(raw, { enabled: true, reserveTokens: 16_384 })).toMatchObject({ usedTokens: null, isStale: true });
    expect(contextFromPi(raw, { enabled: true, reserveTokens: 16_384 }, 12_000)).toMatchObject({ usedTokens: 12_000, isStale: false });
  });

  it('does not invent a Pi reserve when metadata is absent or auto-compaction is off', () => {
    expect(contextFromPi({ tokens: 12, contextWindow: 200_000 })?.limitTokens).toBe(200_000);
    expect(contextFromPi({ tokens: 12, contextWindow: 200_000 }, { enabled: false, reserveTokens: 16_384 })).toMatchObject({ limitTokens: 200_000, limitKind: 'context', canCompact: true });
    expect(contextFromPi({ tokens: 12, contextWindow: 100 }, { enabled: true, reserveTokens: 200 })?.limitTokens).toBeUndefined();
  });

  it('treats absent or malformed Pi usage as no snapshot, never as zero', () => {
    expect(contextFromPi(undefined, { enabled: true, reserveTokens: 16_384 })).toBeUndefined();
    expect(contextFromPi({ tokens: Number.NaN, contextWindow: 200_000 })).toMatchObject({ usedTokens: null, isStale: true });
    expect(contextFromPi({ tokens: -1, contextWindow: 200_000 })?.usedTokens).toBeNull();
    expect(contextFromPi({ tokens: 0, contextWindow: 200_000 })).toMatchObject({ usedTokens: 0, isStale: false });
  });
});

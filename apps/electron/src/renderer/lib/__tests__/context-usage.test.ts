import { describe, expect, it } from 'bun:test'
import { contextBadgeUsage } from '../context-usage'
import type { Session } from '../../../shared/types'

type TokenUsage = NonNullable<Session['tokenUsage']>

function ledger(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 4_000,
    outputTokens: 200,
    totalTokens: 4_200,
    contextTokens: 190_000,
    costUsd: 1,
    contextWindow: 200_000,
    ...overrides,
  }
}

describe('context badge occupancy', () => {
  it('prefers the authoritative snapshot over the derived pre-compaction count', () => {
    const usage = contextBadgeUsage(ledger({
      contextUsage: {
        usedTokens: 12_000,
        limitTokens: 200_000,
        limitKind: 'context',
        isEstimate: false,
        isStale: false,
        canCompact: true,
      },
    }))
    expect(usage.inputTokens).toBe(12_000)
    expect(usage.isUsageUnknown).toBe(false)
  })

  it('reports unknown occupancy after the context changed, never a stale number', () => {
    // `contextTokens` still holds the pre-compaction count here — the badge must not
    // fall back to it, because that number no longer describes the context (and a
    // percentage derived from it would be equally wrong).
    const usage = contextBadgeUsage(ledger({
      contextUsage: {
        usedTokens: null,
        limitKind: 'compaction',
        isEstimate: true,
        isStale: true,
        canCompact: false,
      },
    }))
    expect(usage.inputTokens).toBeUndefined()
    expect(usage.isUsageUnknown).toBe(true)
  })

  it('keeps the derived count when no snapshot exists at all', () => {
    const usage = contextBadgeUsage(ledger({ contextTokens: 500 }))
    expect(usage.inputTokens).toBe(500)
    expect(usage.isUsageUnknown).toBe(false)
  })

  it('does not mistake a missing session for unknown occupancy', () => {
    expect(contextBadgeUsage(undefined)).toEqual({
      inputTokens: undefined,
      contextWindow: undefined,
      isUsageUnknown: false,
    })
  })

  it('uses the snapshot limit as the denominator only when it is the window', () => {
    const asWindow = contextBadgeUsage(ledger({
      contextWindow: undefined,
      contextUsage: {
        usedTokens: 1_000,
        limitTokens: 150_000,
        limitKind: 'context',
        isEstimate: false,
        isStale: false,
        canCompact: true,
      },
    }))
    expect(asWindow.contextWindow).toBe(150_000)

    const asCompactionLimit = contextBadgeUsage(ledger({
      contextWindow: undefined,
      contextUsage: {
        usedTokens: 1_000,
        limitTokens: 150_000,
        limitKind: 'compaction',
        isEstimate: false,
        isStale: false,
        canCompact: true,
      },
    }))
    expect(asCompactionLimit.contextWindow).toBeUndefined()
  })
})

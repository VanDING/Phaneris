import { describe, expect, it } from 'bun:test'
import { processEvent } from '../../processor'
import { handleUsageUpdate } from '../session'
import type { SessionState } from '../../types'

/** Ledger counters the renderer already holds; occupancy is asserted separately. */
const counters = {
  inputTokens: 1000,
  outputTokens: 100,
  totalTokens: 1100,
  contextTokens: 900,
  costUsd: 1,
}

function stateWith(tokenUsage: Record<string, unknown>) {
  return { session: { id: 's', messages: [], tokenUsage }, streaming: null } as unknown as SessionState
}

describe('usage updates', () => {
  it('replaces ledger totals while a compacted context shrinks, retaining the full breakdown', () => {
    const state = stateWith({ ...counters, contextTokens: 500 })
    const full = { input: 200, output: 150, cacheRead: 1000, cacheWrite: 100, totalTokens: 1450,
      cost: { input: 0.5, output: 0.5, cacheRead: 0.4, cacheWrite: 0.1, total: 1.5 } }
    const tokenUsage = { inputTokens: 1300, outputTokens: 150, totalTokens: 1450,
      contextTokens: 0, contextWindow: 200000, costUsd: 1.5, full }
    const result = handleUsageUpdate(state, { type: 'usage_update', sessionId: 's', tokenUsage })
    expect(result.state.session.tokenUsage).toEqual(tokenUsage)
    expect(state.session.tokenUsage?.contextTokens).toBe(500)
  })

  // Goes through the public dispatch: an occupancy event wired only at handler level
  // would never reach the badge.
  it('replaces occupancy without touching the accumulated counters', () => {
    const state = stateWith({ ...counters })
    const contextUsage = {
      usedTokens: 42_000,
      limitTokens: 200_000,
      limitKind: 'context' as const,
      isEstimate: false,
      isStale: false,
      canCompact: true,
    }

    const result = processEvent(state, { type: 'context_usage', sessionId: 's', contextUsage })

    expect(result.state.session.tokenUsage?.contextUsage).toEqual(contextUsage)
    expect(result.state.session.tokenUsage).toMatchObject(counters)
    expect(state.session.tokenUsage?.contextUsage).toBeUndefined()
  })

  it('keeps a null occupancy after the context changed, and a ledger-only update cannot restore it', () => {
    const state = stateWith({
      ...counters,
      contextUsage: {
        usedTokens: 190_000,
        limitTokens: 200_000,
        limitKind: 'context' as const,
        isEstimate: false,
        isStale: false,
        canCompact: true,
      },
    })

    // Compaction replaced the transcript: the snapshot says there is no fresh count.
    const compacted = processEvent(state, {
      type: 'context_usage',
      sessionId: 's',
      contextUsage: {
        usedTokens: null,
        limitKind: 'compaction' as const,
        isEstimate: true,
        isStale: true,
        canCompact: false,
      },
    })
    expect(compacted.state.session.tokenUsage?.contextUsage?.usedTokens).toBeNull()

    // A later ledger snapshot that carries no occupancy of its own must not wipe it.
    const ledgerOnly = handleUsageUpdate(compacted.state, {
      type: 'usage_update',
      sessionId: 's',
      tokenUsage: { inputTokens: 40, outputTokens: 10, totalTokens: 50, contextTokens: 40,
        contextWindow: 200000, costUsd: 1.1 },
    })
    expect(ledgerOnly.state.session.tokenUsage?.contextUsage?.usedTokens).toBeNull()
    expect(ledgerOnly.state.session.tokenUsage).toMatchObject({ inputTokens: 40, totalTokens: 50, costUsd: 1.1 })
  })
})

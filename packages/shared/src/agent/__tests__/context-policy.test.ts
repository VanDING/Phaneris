import { describe, expect, it } from 'bun:test'
import {
  buildHandoffSeed,
  contextHandoffBudget,
  CONTEXT_HANDOFF_ACTIVE_PHASES,
  isContextPolicy,
  policyAfterToggle,
  validateHandoffDocument,
} from '../context-policy.ts'

const WINDOW_128K = 128_000
const WINDOW_200K = 200_000

describe('context handoff budget', () => {
  it('hands off at 80% of a window whose reservation fits inside the last 20%', () => {
    // 200K and 128K both reserve less than 20% of the window, so the
    // percentage is the binding constraint: 160K and ~102K.
    expect(contextHandoffBudget(WINDOW_200K, 0, 8192).triggerTokens).toBe(160_000)
    expect(contextHandoffBudget(WINDOW_128K, 0, 8192).triggerTokens).toBe(102_400)
  })

  it('lets the reservation bind on smaller windows, handing off before 80%', () => {
    // 60K: 8% document (4.8K) + 1K instruction + 8K next tool step + 4K safety
    // exceed the last 20%, so the subtraction decides.
    const budget = contextHandoffBudget(60_000, 0, 8192)
    expect(budget.outputTokens).toBe(4800)
    expect(budget.triggerTokens).toBe(60_000 - (4800 + 1024 + 8192 + 4096))
    expect(budget.triggerTokens).toBeLessThan(60_000 * 0.8)
  })

  it('never triggers before half the window is spent, however tight the reservation', () => {
    // A tiny window cannot afford the fixed reservations; the floor keeps the
    // first request from handing off immediately.
    expect(contextHandoffBudget(20_000, 0, 8192).triggerTokens).toBe(10_000)
  })

  it('caps the document at the model output limit when that is the smallest bound', () => {
    expect(contextHandoffBudget(200_000, 0, 2048).outputTokens).toBe(2048)
  })

  it('refuses to start a handoff that cannot fit even a minimal document', () => {
    // Only 5K left: the instruction and the safety margin alone exceed it.
    const tight = contextHandoffBudget(WINDOW_128K, WINDOW_128K - 5000, 8192)
    expect(tight.canGenerate).toBe(false)
    expect(tight.outputTokens).toBe(0)
  })

  it('shrinks the document instead of failing when a tool batch jumped past the trigger', () => {
    // 115K is past the trigger and no longer affords the 8K target, but the
    // handoff still runs with what remains — a short document beats a stall.
    const late = contextHandoffBudget(WINDOW_128K, 115_000, 8192)
    expect(late.canGenerate).toBe(true)
    expect(late.outputTokens).toBe(128_000 - 115_000 - 1024 - 6400)
    expect(late.outputTokens).toBeLessThan(8192)
  })

  it('spends the full target when the remaining room covers the reservation', () => {
    const roomy = contextHandoffBudget(WINDOW_128K, 100_000, 8192)
    expect(roomy.canGenerate).toBe(true)
    expect(roomy.outputTokens).toBe(8192)
  })

  it('treats an unknown window as unusable rather than triggering at zero', () => {
    const unknown = contextHandoffBudget(0, 0, 8192)
    expect(unknown.canGenerate).toBe(false)
    expect(unknown.triggerTokens).toBe(0)
  })

  it('widens the next-step reservation when a tool batch grew faster than the floor', () => {
    const growing = contextHandoffBudget(WINDOW_200K, 0, 8192, 40_000)
    expect(growing.triggerTokens).toBe(200_000 - (8192 + 1024 + 40_000 + 10_000))
  })
})

describe('handoff document contract', () => {
  const document = [
    '# Goal', 'Ship the context policy.', '',
    '# Completed', 'Wired the SDK compaction toggle.', '',
    '# State', 'Modified packages/shared/src/agent/context-policy.ts.', '',
    '# Next', 'Render the settings section.', '',
    '# References', 'docs/handoff.md',
  ].join('\n')

  it('accepts a document carrying every required section', () => {
    expect(validateHandoffDocument(document)).toBe(true)
  })

  it('rejects a document missing a section', () => {
    expect(validateHandoffDocument(document.replace('# Next', '## Todo'))).toBe(false)
  })

  it('rejects a document too short to continue from', () => {
    expect(validateHandoffDocument('# Goal\n# Completed\n# State\n# Next\n# References')).toBe(false)
  })
})

describe('handoff seed', () => {
  it('carries host-appended paths plus the document and messages committed after the cutoff', () => {
    const seed = buildHandoffSeed({
      document: '# Goal\nresume',
      rootSessionId: 'root',
      previousSessionId: 'prev',
      sessionPath: '/ws/sessions/prev/session.jsonl',
      documentPath: '/ws/sessions/prev/handoffs/h1.md',
      handoffsPath: '/ws/sessions/prev/handoffs',
      workingDirectory: '/ws/project',
      activePlugin: 'review',
      lateMessages: ['and also fix the badge'],
    })
    expect(seed).toContain('Original session: root')
    expect(seed).toContain('Previous session: prev')
    expect(seed).toContain('Full history: /ws/sessions/prev/session.jsonl')
    expect(seed).toContain('Handoff file: /ws/sessions/prev/handoffs/h1.md')
    expect(seed).toContain('Earlier handoffs in this chain: /ws/sessions/prev/handoffs')
    expect(seed).toContain('Working directory: /ws/project')
    expect(seed).toContain('Active plugin: review')
    expect(seed).toContain('# Goal\nresume')
    expect(seed).toContain('and also fix the badge')
  })

  it('omits the late-message section when nothing arrived during generation', () => {
    const seed = buildHandoffSeed({
      document: '# Goal\nresume', rootSessionId: 'root', previousSessionId: 'prev',
      sessionPath: '/ws/s.jsonl', documentPath: '/ws/h.md', handoffsPath: '/ws/handoffs',
    })
    expect(seed).not.toContain('New user messages')
  })
})

describe('context policy values', () => {
  it('accepts exactly the three mutually exclusive strategies', () => {
    expect(isContextPolicy('compact')).toBe(true)
    expect(isContextPolicy('handoff')).toBe(true)
    expect(isContextPolicy('manual')).toBe(true)
    expect(isContextPolicy('both')).toBe(false)
    expect(isContextPolicy(undefined)).toBe(false)
  })

  it('turns the other strategy off whenever one is switched on', () => {
    expect(policyAfterToggle('compact', 'handoff', true)).toBe('handoff')
    expect(policyAfterToggle('handoff', 'compact', true)).toBe('compact')
    expect(policyAfterToggle('manual', 'compact', true)).toBe('compact')
    expect(policyAfterToggle('manual', 'handoff', true)).toBe('handoff')
  })

  it('leaves the session without an automatic strategy when the active one is switched off', () => {
    expect(policyAfterToggle('compact', 'compact', false)).toBe('manual')
    expect(policyAfterToggle('handoff', 'handoff', false)).toBe('manual')
  })

  it('never lets switching off an inactive strategy replace the active one', () => {
    expect(policyAfterToggle('handoff', 'compact', false)).toBe('handoff')
    expect(policyAfterToggle('compact', 'handoff', false)).toBe('compact')
  })

  it('treats only unfinished phases as owning the session', () => {
    expect(CONTEXT_HANDOFF_ACTIVE_PHASES.generating).toBe(true)
    expect(CONTEXT_HANDOFF_ACTIVE_PHASES.ready).toBe(true)
    expect(CONTEXT_HANDOFF_ACTIVE_PHASES.starting).toBe(true)
    expect(CONTEXT_HANDOFF_ACTIVE_PHASES.complete).toBeUndefined()
    expect(CONTEXT_HANDOFF_ACTIVE_PHASES.failed).toBeUndefined()
    expect(CONTEXT_HANDOFF_ACTIVE_PHASES.cancelled).toBeUndefined()
  })
})

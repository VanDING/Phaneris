import { describe, it, expect } from 'bun:test'
import type { ActivityItem } from '../../components/chat/TurnCard'
import { extractOverlayData } from '../tool-parsers'

function makeActivity(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'tool-1',
    type: 'tool',
    status: 'completed',
    timestamp: Date.now(),
    toolName: 'mcp__session__ask_user',
    toolInput: {},
    content: '',
    ...overrides,
  }
}

/**
 * The Pi backend exposes session tools with the `mcp__session__` prefix; the
 * Claude path uses the bare name. Both must reach the transcript renderer.
 */
describe('ask_user overlay', () => {
  it('pairs questions with answers into one readable transcript', () => {
    const activity = makeActivity({
      toolInput: {
        questions: [
          {
            id: 'approach',
            header: 'Choose approach',
            question: 'Which approach should I take?',
            detail: 'Rewriting touches **3 modules**.',
            options: [
              { label: 'Rewrite (Recommended)' },
              { label: 'Patch' },
            ],
          },
        ],
      },
      content: JSON.stringify({ answers: [{ id: 'approach', selected: ['Patch'] }] }),
    })

    const overlay = extractOverlayData(activity)
    expect(overlay?.type).toBe('document')
    if (overlay?.type !== 'document') return

    expect(overlay.filePath).toBe('ask_user')
    expect(overlay.content).toContain('**Choose approach**')
    expect(overlay.content).toContain('Which approach should I take?')
    // `detail` is supporting content, kept out of the option labels.
    expect(overlay.content).toContain('Rewriting touches **3 modules**.')
    // The answer is echoed under the question it belongs to.
    expect(overlay.content).toContain('> Patch')
  })

  it('renders free-text and multi-select answers together', () => {
    const activity = makeActivity({
      toolInput: {
        questions: [{ id: 'scope', question: 'What should I cover?' }],
      },
      content: JSON.stringify({
        answers: [{ id: 'scope', selected: ['Docs', 'Tests'], custom: 'and the CLI help' }],
      }),
    })

    const overlay = extractOverlayData(activity)
    if (overlay?.type !== 'document') throw new Error('expected a document overlay')

    expect(overlay.content).toContain('> Docs, Tests, and the CLI help')
  })

  it('marks a question the user never answered', () => {
    const activity = makeActivity({
      toolInput: { questions: [{ id: 'q', question: 'Pick one' }] },
      content: JSON.stringify({ answers: [{ id: 'q', selected: [] }] }),
    })

    const overlay = extractOverlayData(activity)
    if (overlay?.type !== 'document') throw new Error('expected a document overlay')

    expect(overlay.content).toContain('> (unanswered)')
  })

  it('recognises the bare session tool name used by the Claude path', () => {
    const activity = makeActivity({
      toolName: 'ask_user',
      toolInput: { questions: [{ id: 'q', question: 'Continue?' }] },
      content: JSON.stringify({ answers: [{ id: 'q', selected: ['Yes'] }] }),
    })

    expect(extractOverlayData(activity)?.type).toBe('document')
  })

  it('falls through to the generic viewer when the result is not the expected shape', () => {
    const activity = makeActivity({
      toolInput: { questions: [{ id: 'q', question: 'Continue?' }] },
      content: 'plain text, not JSON',
    })

    // No paired transcript is possible, so the generic rendering owns it.
    const overlay = extractOverlayData(activity)
    expect(overlay?.type).toBe('generic')
    if (overlay?.type !== 'generic') return
    // The raw result is still shown, so nothing is hidden from the user.
    expect(overlay.content).toContain('plain text, not JSON')
  })
})

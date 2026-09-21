import { describe, expect, it } from 'bun:test'
import { atom, createStore } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { recordMessageTextUpdate } from '@phaneris/core/utils'
import type { Message, Session } from '../../../shared/types'
import { equalChatSessions, selectChatSession } from '../chat-session-view'

function fixture(): Session {
  return { id: 'buffered', workspaceId: 'test', isProcessing: true, messages: [
    { id: 'question', role: 'user', content: 'Hello', timestamp: 1 },
    { id: 'answer', role: 'assistant', content: 'First', timestamp: 2, isPending: true, isStreaming: true },
  ] } as Session
}

describe('buffered chat subscription', () => {
  it('receives every token in the source without notifying the view, then publishes full completion', () => {
    const store = createStore()
    const source = atom<Session | null>(fixture())
    const view = selectAtom(source, selectChatSession, equalChatSessions)
    const initial = store.get(view)
    let commits = 0
    const unsubscribe = store.sub(view, () => commits++)
    for (let i = 0; i < 1000; i++) {
      const previous = store.get(source)!
      const messages = previous.messages.map((message, index) => index === 1
        ? { ...message, content: message.content + '.' } : message)
      recordMessageTextUpdate(previous.messages, messages, 1)
      store.set(source, { ...previous, messages })
    }
    expect(store.get(source)!.messages[1]!.content.length).toBe(1005)
    expect(store.get(view)).toBe(initial)
    expect(commits).toBe(0)
    const current = store.get(source)!
    store.set(source, { ...current, isProcessing: false, messages: current.messages.map(message => ({ ...message, isPending: false, isStreaming: false })) })
    expect(store.get(view)!.messages[1]!.content).toBe('First' + '.'.repeat(1000))
    expect(commits).toBe(1)
    unsubscribe()
  })

  it('publishes tools, retry/status changes, errors and corrected text immediately', () => {
    const initial = fixture()
    const changed: Session[] = [
      { ...initial, isProcessing: false },
      { ...initial, currentStatus: { message: 'Retrying' } } as Session,
      { ...initial, messages: [...initial.messages, { id: 'tool', role: 'tool', content: 'Done', timestamp: 3 } as Message] },
      { ...initial, messages: [{ id: 'error', role: 'error', content: 'Interrupted', timestamp: 3 } as Message] },
      { ...initial, messages: initial.messages.map(m => ({ ...m, content: 'Corrected' })) },
    ]
    for (const next of changed) {
      expect(selectChatSession(next)).toBe(next)
      expect(equalChatSessions(initial, next)).toBe(false)
    }
  })

  it('does not suppress text updates to completed or annotated messages', () => {
    for (const annotated of [false, true]) {
      const previous = fixture()
      const message = { ...previous.messages[1]!, isPending: annotated, isStreaming: annotated,
        ...(annotated ? { annotations: [{ id: 'annotation' }] as Message['annotations'] } : {}) }
      const messages = [previous.messages[0]!, message]
      recordMessageTextUpdate(previous.messages, messages, 1)
      const next = { ...previous, messages }
      expect(selectChatSession(next)).toBe(next)
    }
  })
})

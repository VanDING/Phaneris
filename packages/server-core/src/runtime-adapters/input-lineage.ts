import type { Message } from '@phaneris/core/types'

/** Only Host-authored continuations inherit input identity; human follow-ups do not. */
export function attributedRuntimeInputIds(messages: readonly Message[], inputIds: readonly string[] = []): string[] {
  const byId = new Map(messages.map(message => [message.id, message]))
  const visited = new Set<string>(), pending = [...inputIds]
  while (pending.length) {
    const id = pending.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const source = byId.get(id)?.inputSource
    if (source?.kind === 'runtime_continuation') {
      for (const original of source.inputMessageIds) if (byId.has(original) && !visited.has(original)) pending.push(original)
    }
  }
  return [...visited]
}

/** Forward aliases keep exact Runtime attempts on the original assignment's detail view. */
export function runtimeInputAliases(messages: readonly Message[], originalId: string): string[] {
  const aliases = new Set([originalId])
  for (const message of messages) if (message.inputSource?.kind === 'runtime_continuation'
    && message.inputSource.inputMessageIds.some(id => aliases.has(id))) aliases.add(message.id)
  return [...aliases]
}

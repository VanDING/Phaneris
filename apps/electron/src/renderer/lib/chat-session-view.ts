import { getMessageStructureSource, getMessageTextUpdate } from '@phaneris/core/utils'
import type { Session } from '../../shared/types'

/** The buffered chat shows pending text as a status, not as a live transcript.
 * Keep its presentation stable without dropping any events from the source atom.
 * Completion, errors, tools, annotations and metadata still pass through normally.
 */
export function selectChatSession(session: Session | null): Session | null {
  if (!session) return null
  const update = getMessageTextUpdate(session.messages)
  const message = update && session.messages[update.index]
  if (!message?.isPending || !message.isStreaming) return session
  const messages = getMessageStructureSource(session.messages)
  return messages === session.messages ? session : { ...session, messages }
}

export function equalChatSessions(previous: Session | null, next: Session | null): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  const keys = Object.keys(next) as (keyof Session)[]
  return keys.length === Object.keys(previous).length
    && keys.every(key => Object.is(previous[key], next[key]))
}

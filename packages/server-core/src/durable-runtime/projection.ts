import type { DurableCanonicalContextItem, DurableJsonObject, RuntimeEvent, ToolOutcome } from '@phaneris/shared/durable-runtime'

export type DurableProjectionItem = DurableCanonicalContextItem

export interface DurableSessionProjection {
  cursor: number
  items: DurableProjectionItem[]
}

export interface DurableWorkspaceSessionProjection {
  sessions: Record<string, DurableSessionProjection>
}

/**
 * Rebuild a semantic session view from canonical facts only. Partial transport
 * fragments and internal control events can never leak into model context.
 */
export function projectDurableSession(events: RuntimeEvent[]): DurableSessionProjection {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const items: DurableProjectionItem[] = []
  let cursor = 0

  for (const event of ordered) {
    const seq = event.seq ?? 0
    cursor = Math.max(cursor, seq)
    if (!event.modelVisible || event.partial) continue

    if (event.type === 'legacy_context_imported') {
      const payload = event.payload as {
        kind?: unknown; content?: unknown; toolCallId?: unknown
        toolName?: unknown; args?: unknown; result?: unknown; isError?: unknown; hasOutcome?: unknown
      }
      if ((payload.kind === 'user' || payload.kind === 'assistant') && typeof payload.content === 'string') {
        items.push({ kind: payload.kind, eventId: event.eventId, seq, operationId: event.operationId, content: payload.content })
      } else if (payload.kind === 'tool' && typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string') {
        items.push({
          kind: 'tool_call', eventId: `${event.eventId}:call`, seq, operationId: event.operationId,
          toolOperationId: `legacy:${payload.toolCallId}`, toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          args: payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args as DurableJsonObject : {},
        })
        if (payload.hasOutcome === true) items.push({
          kind: 'tool_outcome', eventId: `${event.eventId}:outcome`, seq, operationId: event.operationId,
          toolOperationId: `legacy:${payload.toolCallId}`, toolCallId: payload.toolCallId,
          toolName: payload.toolName, result: payload.result, isError: payload.isError === true,
        })
      }
      continue
    }

    if (event.type === 'user_message_committed' || event.type === 'assistant_message_committed') {
      const payload = event.payload as { content?: unknown }
      if (typeof payload.content !== 'string') continue
      items.push({
        kind: event.type === 'user_message_committed' ? 'user' : 'assistant',
        eventId: event.eventId,
        seq,
        operationId: event.operationId,
        content: payload.content,
      })
      continue
    }

    if (event.type === 'tool_call_observed') {
      const payload = event.payload as {
        toolOperationId?: unknown
        providerToolCallId?: unknown
        toolName?: unknown
        args?: unknown
      }
      if (typeof payload.toolOperationId !== 'string'
        || typeof payload.providerToolCallId !== 'string'
        || typeof payload.toolName !== 'string'
        || typeof payload.args !== 'object'
        || payload.args === null
        || Array.isArray(payload.args)) continue
      items.push({
        kind: 'tool_call',
        eventId: event.eventId,
        seq,
        operationId: event.operationId,
        toolOperationId: payload.toolOperationId,
        toolCallId: payload.providerToolCallId,
        toolName: payload.toolName,
        args: payload.args as DurableJsonObject,
      })
      continue
    }

    if (event.type === 'tool_outcome_committed') {
      const outcome = event.payload as ToolOutcome
      if (!outcome.operationId || !outcome.providerToolCallId || !outcome.toolName) continue
      items.push({
        kind: 'tool_outcome',
        eventId: event.eventId,
        seq,
        operationId: event.operationId,
        toolOperationId: outcome.operationId,
        toolCallId: outcome.providerToolCallId,
        toolName: outcome.toolName,
        result: outcome.result,
        isError: outcome.isError,
      })
    }
  }

  return { cursor, items }
}

export function projectModelContext(events: RuntimeEvent[]): DurableProjectionItem[] {
  return projectDurableSession(events).items
}

export function reduceWorkspaceSessionProjection(
  previous: DurableWorkspaceSessionProjection,
  events: RuntimeEvent[],
): DurableWorkspaceSessionProjection {
  const sessions = { ...previous.sessions }
  const grouped = new Map<string, RuntimeEvent[]>()
  for (const event of events) {
    const group = grouped.get(event.sessionId) ?? []
    group.push(event)
    grouped.set(event.sessionId, group)
  }
  for (const [sessionId, sessionEvents] of grouped) {
    const prior = sessions[sessionId] ?? { cursor: 0, items: [] }
    const delta = projectDurableSession(sessionEvents)
    sessions[sessionId] = {
      cursor: Math.max(prior.cursor, delta.cursor),
      items: [...prior.items, ...delta.items],
    }
  }
  return { sessions }
}

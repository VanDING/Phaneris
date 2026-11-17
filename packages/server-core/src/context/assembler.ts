import type { DurableCanonicalModelContext } from '@phaneris/shared/durable-runtime/types'

/** All Sessions cross this selection boundary. Linear/Worker history remains Pi
 * native; resident selections are exact. Execution and compaction stay on Pi. */
export function assembleContext(input: { strategy: 'linear' | 'branches' | 'task'; canonical?: DurableCanonicalModelContext;
  items?: DurableCanonicalModelContext['items']; segmentId?: string; contextText?: string; blocked?: string }): DurableCanonicalModelContext | undefined {
  if (!input.canonical) return undefined // Native journal is newer or compatibility parity is unresolved.
  if (input.strategy !== 'branches') return { ...input.canonical, ...(input.strategy === 'task' ? { fenced: true } : {}) }
  if (!input.segmentId) throw new Error('context_view_missing: Branch selection needs a committed view identity')
  return { cursor: input.canonical.cursor, items: input.items ?? [], fenced: true, blocked: input.blocked,
    resident: { segmentId: input.segmentId, contextText: input.contextText ?? '',
      preparation: input.canonical.resident?.preparation } }
}

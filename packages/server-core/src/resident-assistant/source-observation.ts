import type { ToolObservationReference } from '@phaneris/core/types'
import type { ToolOutcome } from '@phaneris/shared/durable-runtime'
import { canonicalJson, canonicalToolArgsHash } from '@phaneris/shared/durable-runtime/identity'

export type ObservationVerifier = (source: { sessionId: string; operationId: string; providerToolCallId: string;
  toolName: string; toolInput: Record<string, unknown>; toolResult: string }) => ToolObservationReference | undefined

/** A model annotation or a forged transcript cannot create an execution observation. */
export function createObservationVerifier(lookup: (operationId: string) => { sessionId: string; outcome: ToolOutcome } | undefined,
  sessionRoots: (sessionId: string) => readonly string[] = () => []): ObservationVerifier {
  return source => {
    const snapshot = lookup(source.operationId)
    if (!snapshot || snapshot.sessionId !== source.sessionId) return
    const outcome = snapshot.outcome
    if (outcome.isError || outcome.operationId !== source.operationId || outcome.providerToolCallId !== source.providerToolCallId || outcome.toolName !== source.toolName) return
    let observed: unknown = source.toolResult
    if (typeof outcome.result !== 'string') {
      try { observed = JSON.parse(source.toolResult) } catch { return }
    }
    const roots = [...new Set(sessionRoots(source.sessionId))], current = roots[0]
    // Session JSONL deliberately expands portable paths with forward slashes.
    // Verify the exact original receipt after reversing only Host-owned layout aliases.
    const restore = (value: unknown, originalRoot: string): unknown => {
      if (typeof value === 'string') return current ? value.replaceAll(current.replaceAll('\\', '/'), originalRoot).replaceAll(current, originalRoot) : value
      if (Array.isArray(value)) return value.map(item => restore(item, originalRoot))
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item, originalRoot)]))
      return value
    }
    const matches = (args: unknown, result: unknown) => canonicalToolArgsHash(source.toolName, args) === outcome.canonicalArgsHash && canonicalJson(result) === canonicalJson(outcome.result)
    if (!matches(source.toolInput, observed) && !roots.some(root => matches(restore(source.toolInput, root), restore(observed, root)))) return
    return { operationId: outcome.operationId, runOperationId: outcome.runOperationId }
  }
}

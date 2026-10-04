import type { DurableToolExecutionIdentity } from '../../shared/src/durable-runtime/types.ts'

export type ContextWithDurableTool<T> = T & {
  durableTool: DurableToolExecutionIdentity
}

export function attachDurableToolContext<T>(
  context: T,
  durableTool: DurableToolExecutionIdentity,
): ContextWithDurableTool<T> {
  // SDK contexts expose tools/executeTool as lazy getters. Spreading loses
  // non-enumerable capabilities and prevents nested execution in codemode.
  const enriched = Object.create(context && typeof context === 'object' ? context : null)
  if (context && typeof context === 'object') Object.defineProperties(enriched, Object.getOwnPropertyDescriptors(context))
  Object.defineProperty(enriched, 'durableTool', { value: durableTool, enumerable: true })
  return enriched as ContextWithDurableTool<T>
}

export function durableToolFromContext(context: unknown): DurableToolExecutionIdentity | undefined {
  if (!context || typeof context !== 'object') return undefined
  return (context as { durableTool?: DurableToolExecutionIdentity }).durableTool
}

import { createHash } from 'node:crypto'

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, normalize(entry)]))
  return value
}
export function canonicalJson(value: unknown): string { return JSON.stringify(normalize(value)) }
export function canonicalToolArgsHash(toolName: string, args: unknown): string {
  return createHash('sha256').update(canonicalJson({ toolName, args })).digest('hex')
}
export function durableToolOperationId(runOperationId: string, providerToolCallId: string): string {
  return `toolop_${createHash('sha256').update(canonicalJson([runOperationId, providerToolCallId])).digest('hex').slice(0, 32)}`
}

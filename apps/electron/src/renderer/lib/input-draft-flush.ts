/** Mounted composer leases. A workspace transition snapshots text before any RPC or unmount. */
const composers = new Set<() => void>()
export function registerInputDraftFlush(flush: () => void): () => void {
  composers.add(flush)
  return () => { composers.delete(flush) }
}
export function flushInputDrafts(): void {
  for (const flush of [...composers]) flush()
}

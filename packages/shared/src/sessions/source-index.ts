import { statSync } from 'node:fs'
import type { SessionHeader } from './types'

export interface SessionSourceEntry { id: string; offset: number; length: number; version: string }
export interface SessionSourceIndex { signature: string; header: SessionHeader; entries: SessionSourceEntry[]; byId: Map<string, SessionSourceEntry> }
/** Estimated locator bytes, not transcript bytes or a promise about heap size.
 * Budget is a design limit; entries are references, never cached message bodies. */
class SessionSourceIndexCache extends Map<string, SessionSourceIndex> {
  private bytes = 0
  private readonly weights = new WeakMap<SessionSourceIndex, number>()
  constructor(private readonly budget = 16 * 1024 * 1024) { super() }
  private weight(index: SessionSourceIndex): number {
    let weight = this.weights.get(index)
    if (weight === undefined) { weight = 512 + index.entries.reduce((sum, entry) => sum + 160 + 2 * (entry.id.length + entry.version.length), 0); this.weights.set(index, weight) }
    return weight
  }
  override delete(key: string): boolean {
    const prior = this.get(key)
    if (prior) this.bytes -= this.weight(prior)
    return super.delete(key)
  }
  override set(key: string, index: SessionSourceIndex): this {
    this.delete(key)
    const weight = this.weight(index)
    if (weight > this.budget) return this
    super.set(key, index); this.bytes += weight
    while (this.bytes > this.budget) this.delete(this.keys().next().value!)
    return this
  }
  estimatedBytes(): number { return this.bytes }
}
const indexes = new SessionSourceIndexCache()
export function sessionSourceIndexMetrics() { return { indexedSessions: indexes.size, estimatedIndexBytes: indexes.estimatedBytes(), indexBudgetScope: 'process' as const } }
export function releaseSessionSourceIndex(file: string): void { indexes.delete(file) }
export function sessionSourceSignature(file: string): string {
  const stat = statSync(file)
  return JSON.stringify([stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs])
}
export function getSessionSourceIndex(file: string, signature: string): SessionSourceIndex | undefined {
  const index = indexes.get(file)
  if (index?.signature !== signature) return undefined
  indexes.delete(file); indexes.set(file, index); return index
}
/** Writer/Reader share rebuildable byte locators; no source body is cached. */
export function registerSessionSourceIndex(file: string, header: SessionHeader, entries: SessionSourceEntry[]): SessionSourceIndex {
  const index = { signature: sessionSourceSignature(file), header, entries, byId: new Map(entries.map(entry => [entry.id, entry])) }
  indexes.delete(file); indexes.set(file, index)
  return index
}

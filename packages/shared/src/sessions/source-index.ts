import { statSync } from 'node:fs'
import type { SessionHeader } from './types'

export interface SessionSourceEntry { id: string; offset: number; length: number; version: string }
export interface SessionSourceIndex { signature: string; header: SessionHeader; entries: SessionSourceEntry[]; byId: Map<string, SessionSourceEntry> }
const indexes = new Map<string, SessionSourceIndex>()
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
  while (indexes.size > 8) indexes.delete(indexes.keys().next().value!)
  return index
}

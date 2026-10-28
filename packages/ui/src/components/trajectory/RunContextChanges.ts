import type { TrajectoryContextItem } from './trajectory-context'

export type ContextContentMode = 'original' | 'changes'
export type ContextReadItem = TrajectoryContextItem & {
  change?: 'added' | 'modified' | 'removed'
  previousItem?: TrajectoryContextItem
}

// Prompt and schema IDs are request-scoped; message IDs persist across requests.
function identity(item: TrajectoryContextItem): string {
  return item.category === 'system' ? 'system' : item.category === 'schemas' ? item.label : item.id
}

export function contextItemChanges(current: readonly TrajectoryContextItem[], previous: readonly TrajectoryContextItem[]): ContextReadItem[] {
  const before = new Map(previous.map(item => [identity(item), item]))
  const after = new Set(current.map(identity))
  const changes: ContextReadItem[] = []
  for (const item of current) {
    const old = before.get(identity(item))
    if (!old) changes.push({ ...item, change: 'added' })
    else if (old.chars !== item.chars || old.content !== item.content
      || (old.contentHash !== undefined && item.contentHash !== undefined && old.contentHash !== item.contentHash)) {
      changes.push({ ...item, change: 'modified', previousItem: old })
    }
  }
  for (const item of previous) {
    if (!after.has(identity(item))) changes.push({ ...item, change: 'removed' })
  }
  return changes
}

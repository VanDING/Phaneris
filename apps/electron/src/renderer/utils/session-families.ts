import type { SessionMeta } from '@/atoms/sessions'

export interface SessionFamilies {
  /** Root metadata for sorting/grouping only. Actual rows use itemsById. */
  roots: SessionMeta[]
  itemsById: Map<string, SessionMeta>
  childrenById: Map<string, SessionMeta[]>
  parentById: Map<string, string>
}

/** Group after filtering, before pagination. Ancestors are context; unmatched siblings stay hidden. */
export function buildSessionFamilies(matches: SessionMeta[], allItems: SessionMeta[], preserveMatchOrder = false): SessionFamilies {
  const available = new Map(allItems.filter(item => !item.hidden).map(item => [item.id, item]))
  const itemsById = new Map<string, SessionMeta>()
  for (const match of matches) {
    let item = available.get(match.id)
    while (item && !itemsById.has(item.id)) {
      itemsById.set(item.id, item)
      item = item.parentSessionId ? available.get(item.parentSessionId) : undefined
    }
  }
  const parentById = new Map<string, string>()
  for (const item of itemsById.values()) {
    if (item.parentSessionId && itemsById.has(item.parentSessionId)) parentById.set(item.id, item.parentSessionId)
  }
  // Malformed legacy cycles must not make sessions disappear or recurse forever.
  const visited = new Set<string>()
  for (const id of itemsById.keys()) {
    const path = new Set<string>()
    let cursor: string | undefined = id
    while (cursor && !visited.has(cursor)) {
      if (path.has(cursor)) { parentById.delete(cursor); break }
      path.add(cursor)
      cursor = parentById.get(cursor)
    }
    for (const entry of path) visited.add(entry)
  }
  const childrenById = new Map<string, SessionMeta[]>()
  for (const [id, parent] of parentById) {
    const siblings = childrenById.get(parent) ?? []
    siblings.push(itemsById.get(id)!)
    childrenById.set(parent, siblings)
  }
  for (const siblings of childrenById.values()) {
    siblings.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
  }
  const summarize = (item: SessionMeta): SessionMeta => {
    const children = (childrenById.get(item.id) ?? []).map(summarize)
    return { ...item,
      lastMessageAt: Math.max(item.lastMessageAt ?? item.createdAt ?? 0, ...children.map(child => child.lastMessageAt ?? 0)),
      hasUnread: item.hasUnread || children.some(child => child.hasUnread),
    }
  }
  const roots = [...itemsById.values()].filter(item => !parentById.has(item.id)).map(summarize)
  if (!preserveMatchOrder) roots.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.id.localeCompare(b.id))
  return { roots, itemsById, childrenById, parentById }
}

export function sessionDescendants(id: string, families: SessionFamilies): SessionMeta[] {
  return (families.childrenById.get(id) ?? []).flatMap(child => [child, ...sessionDescendants(child.id, families)])
}

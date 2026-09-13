import { describe, expect, test } from 'bun:test'
import { buildSessionFamilies, sessionDescendants } from '../session-families'
import { computeCollapsedPagination } from '../../hooks/useSessionSearch'
import type { SessionMeta } from '@/atoms/sessions'

const session = (id: string, fields: Partial<SessionMeta> = {}): SessionMeta => ({ id, workspaceId: 'w', createdAt: 1, lastMessageAt: 1, ...fields })

describe('session families', () => {
  test('groups before pagination, ranks by descendant activity and keeps actual parent status intact', () => {
    const parent = session('parent', { sessionStatus: 'done' })
    const child = session('child', { parentSessionId: 'parent', lastMessageAt: 100, hasUnread: true })
    const all = [session('other', { lastMessageAt: 50 }), child, parent]
    const families = buildSessionFamilies(all, all)
    const page = computeCollapsedPagination(families.roots, 1)
    expect(page.paginatedItems.map(item => item.id)).toEqual(['parent'])
    expect(page.hasMore).toBe(true)
    expect(families.roots[0]?.lastMessageAt).toBe(100)
    expect(families.roots[0]?.hasUnread).toBe(true)
    expect(families.roots[0]?.sessionStatus).toBe('done')
    expect(families.itemsById.get('parent')).toBe(parent)
    expect(parent.lastMessageAt).toBe(1)
    expect(sessionDescendants('parent', families).map(item => item.id)).toEqual(['child'])
  })

  test('a filtered child brings its ancestors, without bringing excluded siblings', () => {
    const all = [session('root'), session('parent', { parentSessionId: 'root' }), session('hit', { parentSessionId: 'parent' }), session('excluded', { parentSessionId: 'parent' })]
    const families = buildSessionFamilies([all[2]!], all)
    expect(families.roots.map(item => item.id)).toEqual(['root'])
    expect(sessionDescendants('root', families).map(item => item.id)).toEqual(['parent', 'hit'])
  })

  test('keeps orphans visible and never exposes hidden ancestors or hidden matches', () => {
    const all = [session('missing', { parentSessionId: 'deleted' }), session('hidden', { hidden: true }), session('visible', { parentSessionId: 'hidden' })]
    const families = buildSessionFamilies(all, all)
    expect(families.roots.map(item => item.id)).toEqual(['missing', 'visible'])
    expect(families.itemsById.has('hidden')).toBe(false)
  })

  test('keeps siblings in creation order when their activity changes', () => {
    const all = [session('root'), session('b', { parentSessionId: 'root', createdAt: 20, lastMessageAt: 100 }), session('a', { parentSessionId: 'root', createdAt: 10 })]
    expect(buildSessionFamilies(all, all).childrenById.get('root')?.map(item => item.id)).toEqual(['a', 'b'])
  })

  test('retains search relevance order while deduplicating parent hits', () => {
    const all = [session('root'), session('hit', { parentSessionId: 'root' }), session('other', { lastMessageAt: 1000 })]
    expect(buildSessionFamilies([all[1]!, all[0]!, all[2]!], all, true).roots.map(item => item.id)).toEqual(['root', 'other'])
  })

  test('breaks malformed self and multi-session cycles without losing rows', () => {
    const all = [session('a', { parentSessionId: 'b' }), session('b', { parentSessionId: 'a' }), session('self', { parentSessionId: 'self' })]
    const families = buildSessionFamilies(all, all)
    const ids = families.roots.flatMap(root => [root.id, ...sessionDescendants(root.id, families).map(item => item.id)])
    expect(ids.sort()).toEqual(['a', 'b', 'self'])
  })

  test('collapsing status groups paginates complete families using parent status', () => {
    const all = [session('done', { sessionStatus: 'done' }), session('child', { parentSessionId: 'done', sessionStatus: 'todo' }), session('todo', { sessionStatus: 'todo' })]
    const families = buildSessionFamilies(all, all)
    const page = computeCollapsedPagination(families.roots, 1, new Set(['status-done']), 'status')
    expect(page.paginatedItems.map(item => item.id)).toEqual(['todo'])
    expect(page.collapsedGroupsMeta).toEqual([{ key: 'status-done', count: 1 }])
  })
})

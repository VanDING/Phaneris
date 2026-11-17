/**
 * Behaviour lock for the extracted session filter.
 *
 * This function used to be an inline `useMemo` inside AppShell, so the only way
 * to test it was to mount the entire shell. It is now pure, and these are the
 * behaviours that would otherwise be re-broken silently by a refactor:
 *
 *  - `archived` is the only filter that sees archived sessions
 *  - every other filter, including the secondary ones, works on active sessions
 *  - label includes expand to descendants; excludes are applied after includes
 *  - a project exclude also removes sessions with no project
 *  - `null` primary filter means "not a session surface" and returns nothing
 */
import { describe, expect, it } from 'bun:test'
import { filterSessions, type FilterMap, type SessionFilterInputs } from '../session-filter-model'
import type { SessionMeta } from '@/atoms/sessions'
import type { LabelConfig } from '@phaneris/shared/labels'

const meta = (over: Partial<SessionMeta> & { id: string }): SessionMeta =>
  ({ workspaceId: 'ws', ...over }) as SessionMeta

// The tree is nested children, not a flat parentId list — that shape is what
// getDescendantIds walks.
const labels = [
  {
    id: 'work',
    name: 'Work',
    color: 'accent',
    children: [{ id: 'deep', name: 'Deep work', color: 'accent' }],
  },
] as unknown as LabelConfig[]

const base = (over: Partial<SessionFilterInputs> = {}): SessionFilterInputs => {
  const workspaceMetas = [
    meta({ id: 'a', sessionStatus: 'todo' }),
    meta({ id: 'b', sessionStatus: 'done', isFlagged: true }),
    meta({ id: 'c', sessionStatus: 'todo', isArchived: true }),
    meta({ id: 'd', sessionStatus: 'todo', labels: ['work'] }),
    meta({ id: 'e', sessionStatus: 'todo', labels: ['deep'] }),
    meta({ id: 'f', sessionStatus: 'todo', projectId: 'p1' } as never),
    meta({ id: 'g', sessionStatus: 'todo' }),
  ]
  return {
    workspaceMetas,
    activeMetas: workspaceMetas.filter(m => !m.isArchived),
    sessionFilter: { kind: 'allSessions' },
    listFilter: new Map() as FilterMap,
    labelFilter: new Map() as FilterMap,
    projectFilter: new Map() as FilterMap,
    labelConfigs: labels,
    evaluateViews: () => [],
    ...over,
  }
}

const ids = (rows: SessionMeta[]) => rows.map(r => r.id).sort()

describe('filterSessions', () => {
  it('returns nothing when there is no session surface', () => {
    expect(filterSessions(base({ sessionFilter: null }))).toEqual([])
  })

  it('allSessions excludes archived', () => {
    expect(ids(filterSessions(base()))).toEqual(['a', 'b', 'd', 'e', 'f', 'g'])
  })

  it('archived is the only filter that sees archived sessions', () => {
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'archived' } })))).toEqual(['c'])
  })

  it('flagged reads active sessions only', () => {
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'flagged' } })))).toEqual(['b'])
  })

  it('state filters on the status, defaulting to todo', () => {
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'state', stateId: 'done' } })))).toEqual(['b'])
  })

  it('a label filter expands to descendant labels', () => {
    // 'work' matches its own sessions and those tagged with its child 'deep'.
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'label', labelId: 'work' } })))).toEqual(['d', 'e'])
  })

  it('the __all__ pseudo-label matches anything with any label', () => {
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'label', labelId: '__all__' } })))).toEqual(['d', 'e'])
  })

  it('view filters match either any view or one specific view', () => {
    const evaluateViews = (session: SessionMeta) => (session.id === 'a' || session.id === 'b' ? [{ id: 'v1' }, { id: 'v2' }] : [])
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'view', viewId: '__all__' }, evaluateViews })))).toEqual(['a', 'b'])
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'view', viewId: 'v2' }, evaluateViews })))).toEqual(['a', 'b'])
    expect(ids(filterSessions(base({ sessionFilter: { kind: 'view', viewId: 'missing' }, evaluateViews })))).toEqual([])
  })

  it('secondary status filters include then exclude', () => {
    const include = new Map([['todo', 'include']]) as FilterMap
    expect(ids(filterSessions(base({ listFilter: include })))).toEqual(['a', 'd', 'e', 'f', 'g'])

    const exclude = new Map([['todo', 'exclude']]) as FilterMap
    expect(ids(filterSessions(base({ listFilter: exclude })))).toEqual(['b'])
  })

  it('label excludes win over includes for the same id', () => {
    const both = new Map([['work', 'include'], ['deep', 'exclude']]) as FilterMap
    // 'work' includes d and its descendant e; excluding 'deep' removes e.
    expect(ids(filterSessions(base({ labelFilter: both })))).toEqual(['d'])
  })

  it('a project exclude also drops sessions with no project', () => {
    const exclude = new Map([['p1', 'exclude']]) as FilterMap
    expect(ids(filterSessions(base({ projectFilter: exclude })))).toEqual(['a', 'b', 'd', 'e', 'g'])
  })

  it('a project include keeps only that project', () => {
    const include = new Map([['p1', 'include']]) as FilterMap
    expect(ids(filterSessions(base({ projectFilter: include })))).toEqual(['f'])
  })

  it('layers the secondary filters on top of the primary one', () => {
    const listFilter = new Map([['todo', 'include']]) as FilterMap
    const labelFilter = new Map([['work', 'include']]) as FilterMap
    expect(ids(filterSessions(base({ listFilter, labelFilter })))).toEqual(['d', 'e'])
  })
})


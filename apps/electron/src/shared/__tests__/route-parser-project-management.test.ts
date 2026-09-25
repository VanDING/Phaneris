import { describe, expect, it } from 'bun:test'
import { routes } from '../routes'
import {
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

describe('Project Management routes', () => {
  it('round-trips every enabled projection through its canonical route', () => {
    for (const view of ['overview', 'list', 'board', 'calendar', 'gantt'] as const) {
      const route = routes.view.projectManagement(view)
      const state = parseRouteToNavigationState(route)

      expect(state).toEqual({ navigator: 'projects', view, details: null })
      expect(state && buildRouteFromNavigationState(state)).toBe(route)
    }
  })

  it('migrates legacy aliases to the direct canonical routes', () => {
    const board = parseRouteToNavigationState('board')
    const calendar = parseRouteToNavigationState('calendar')
    const prefixedBoard = parseRouteToNavigationState('projects/board')
    const prefixedCalendar = parseRouteToNavigationState('projects/calendar')

    expect(board).toEqual({ navigator: 'projects', view: 'board', details: null })
    expect(calendar).toEqual({ navigator: 'projects', view: 'calendar', details: null })
    expect(prefixedBoard).toEqual(board)
    expect(prefixedCalendar).toEqual(calendar)
    expect(board && buildRouteFromNavigationState(board)).toBe('kanban')
    expect(calendar && buildRouteFromNavigationState(calendar)).toBe('calendar')
  })

  it('normalizes an explicit overview segment to the compact projects route', () => {
    const state = parseRouteToNavigationState('projects/overview')

    expect(state).toEqual({ navigator: 'projects', view: 'overview', details: null })
    expect(state && buildRouteFromNavigationState(state)).toBe('projects')
  })

  it('keeps project details inside the overview projection', () => {
    const state = parseRouteToNavigationState('projects/project/phaneris')

    expect(state).toEqual({
      navigator: 'projects',
      view: 'overview',
      details: { type: 'project', projectSlug: 'phaneris' },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe('projects/project/phaneris')
  })

  it('no longer parses the retired work-item and schedule detail routes', () => {
    /*
     * Those routes addressed two full-page editors that no longer exist — creating and
     * editing project work happens in the shared Task Definition overlay, which is
     * component state rather than a route. Parsing them again would reintroduce a
     * vocabulary nothing can navigate to, so the assertion is that they are gone.
     */
    for (const route of [
      'kanban/work-item/task%20%2F%2042',
      'calendar/work-item/abc',
      'gantt/work-item/abc',
      'calendar/schedule/new%3A2026-08-25%4014%3A30',
      'projects/calendar/schedule/abc',
      'projects/board/work-item/abc',
    ]) {
      expect(parseRouteToNavigationState(route)).toBeNull()
      expect(parseNavigationStateKey(route)).toBeNull()
    }
  })

  it('still round-trips the projection routes themselves', () => {
    for (const [route, view] of [
      ['kanban', 'board'],
      ['calendar', 'calendar'],
      ['gantt', 'gantt'],
      ['projects/list', 'list'],
    ] as const) {
      const state = parseRouteToNavigationState(route)
      expect(state).toEqual({ navigator: 'projects', view, details: null })
      expect(state && buildRouteFromNavigationState(state)).toBe(route)
      expect(getNavigationStateKey(state!)).toBe(route)
      expect(parseNavigationStateKey(route)).toEqual(state)
    }
  })

  it('persists project projection navigation keys without conflating sessions', () => {
    const state = { navigator: 'projects', view: 'calendar', details: null } as const

    expect(getNavigationStateKey(state)).toBe('calendar')
    expect(parseNavigationStateKey('projects/calendar')).toEqual(state)
    expect(parseNavigationStateKey('calendar')).toEqual(state)
  })

  it('exposes the timeline projection as a first-class route', () => {
    // The view used to be reserved-but-unrouted: `gantt` was absent from the
    // compound-route prefixes, so this returned null and the top-bar launcher
    // navigated nowhere at all.
    expect(parseCompoundRoute('projects/gantt')).toEqual({
      navigator: 'projects',
      projectView: 'gantt',
      details: null,
    })
    expect(parseRouteToNavigationState('gantt')).toEqual({
      navigator: 'projects',
      view: 'gantt',
      details: null,
    })
    expect(parseRouteToNavigationState('projects/gantt')).toEqual({
      navigator: 'projects',
      view: 'gantt',
      details: null,
    })
  })
})

describe('Artifact Workbench routes', () => {
  it('round-trips encoded artifact ids without losing the contextual identity', () => {
    const route = routes.view.artifact('report / v1')
    const state = parseRouteToNavigationState(route)

    expect(route).toBe('artifact/report%20%2F%20v1')
    expect(state).toEqual({ navigator: 'other', panel: 'artifact', artifactId: 'report / v1' })
    expect(state && buildRouteFromNavigationState(state)).toBe(route)
    expect(getNavigationStateKey(state!)).toBe('other:artifact:report / v1')
    expect(parseNavigationStateKey('other:artifact:report / v1')).toEqual(state)
  })

  it('rejects an artifact route without an id', () => {
    expect(parseRouteToNavigationState('artifact' as never)).toBeNull()
  })
})

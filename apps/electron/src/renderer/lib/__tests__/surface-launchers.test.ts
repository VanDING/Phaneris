import { describe, expect, it } from 'bun:test'
import {
  CONTEXT_WORKBENCH_LAUNCHER_KINDS,
  PRIMARY_SURFACE_LAUNCHER_KINDS,
  SURFACE_LAUNCHER_KINDS,
  SURFACE_LAUNCHER_ROUTES,
  isContextWorkbenchKind,
  isPrimarySurfaceKind,
  surfaceLauncherKindForRoute,
} from '../surface-launchers'
import { classifySurfaceRoute } from '../../atoms/workbench'

/**
 * Regression: a launcher kind that is declared primary must BOTH dispatch as
 * navigation and survive a route round-trip. The `gantt` kind was declared
 * primary but the dispatch site hardcoded the primary list, so clicking it took
 * the workbench path — where `createWorkbenchItem` correctly rejected the route
 * as primary — and the button did nothing, with no visible error.
 */
describe('surface launcher registry consistency', () => {
  it('partitions every kind into exactly one role', () => {
    for (const kind of SURFACE_LAUNCHER_KINDS) {
      const primary = isPrimarySurfaceKind(kind)
      const context = isContextWorkbenchKind(kind)
      expect([kind, primary !== context]).toEqual([kind, true])
    }
  })

  it('agrees with the declared primary and context lists', () => {
    for (const kind of PRIMARY_SURFACE_LAUNCHER_KINDS) {
      expect([kind, isPrimarySurfaceKind(kind)]).toEqual([kind, true])
    }
    for (const kind of CONTEXT_WORKBENCH_LAUNCHER_KINDS) {
      expect([kind, isContextWorkbenchKind(kind)]).toEqual([kind, true])
    }
  })

  it('classifies every primary launcher route as a primary surface', () => {
    // This is the exact check the broken dispatch path skipped: a primary
    // launcher's route must never be offered to the workbench.
    for (const kind of PRIMARY_SURFACE_LAUNCHER_KINDS) {
      const route = SURFACE_LAUNCHER_ROUTES[kind]
      expect([kind, classifySurfaceRoute(route)?.role]).toEqual([kind, 'primary'])
      expect([kind, surfaceLauncherKindForRoute(route)]).toEqual([kind, kind])
    }
  })

  it('classifies every context launcher route as a workbench surface', () => {
    for (const kind of CONTEXT_WORKBENCH_LAUNCHER_KINDS) {
      const route = SURFACE_LAUNCHER_ROUTES[kind]
      expect([kind, classifySurfaceRoute(route)?.role]).toEqual([kind, 'workbench'])
      expect([kind, surfaceLauncherKindForRoute(route)]).toEqual([kind, kind])
    }
  })
})

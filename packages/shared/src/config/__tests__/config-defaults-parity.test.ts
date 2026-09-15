import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FALLBACK_CONFIG_DEFAULTS } from '../storage.ts'
import type { ConfigDefaults } from '../config-defaults-schema.ts'
import { isValidThinkingLevel, normalizeThinkingLevel } from '../../agent/thinking-levels.ts'
import { parsePermissionMode } from '../../agent/mode-types.ts'

/**
 * `apps/electron/resources/config-defaults.json` declares itself the source of
 * truth for default settings, and the constant in `storage.ts` is what gets used
 * when that asset is missing (CI, a standalone server). Nothing kept them equal,
 * and they had drifted on the two values that decide how much autonomy a new
 * session starts with.
 *
 * Reading the shipped file here rather than asserting literals means changing the
 * JSON without changing the fallback fails the test, which is the point.
 */
const shippedPath = resolve(import.meta.dir, '../../../../../apps/electron/resources/config-defaults.json')
const shipped = JSON.parse(readFileSync(shippedPath, 'utf8')) as ConfigDefaults

describe('config defaults parity', () => {
  it('keeps the code fallback identical to the shipped asset', () => {
    expect(FALLBACK_CONFIG_DEFAULTS).toEqual(shipped)
  })

  // The shipped file carried `thinkingLevel: "think"` — not a member of the
  // ThinkingLevel union. It only resolved because `normalizeThinkingLevel` still
  // maps that legacy value to 'medium' for old persisted data, and that shim is
  // marked for removal: the day it goes, a shipped default silently becomes
  // undefined. Assert validity directly so the dependency cannot come back.
  it('ships only values that are valid without a legacy shim', () => {
    const { thinkingLevel, permissionMode, cyclablePermissionModes } = shipped.workspaceDefaults

    expect(isValidThinkingLevel(thinkingLevel)).toBe(true)
    expect(normalizeThinkingLevel(thinkingLevel)).toBe(thinkingLevel)
    for (const mode of cyclablePermissionModes) {
      expect(parsePermissionMode(mode)).toBe(mode)
    }
    expect(parsePermissionMode(permissionMode)).toBe(permissionMode)
  })

  it('offers at least two modes to cycle through', () => {
    // The settings surface treats a shorter list as invalid and widens it, so a
    // one-entry default would be silently rewritten.
    expect(shipped.workspaceDefaults.cyclablePermissionModes.length).toBeGreaterThanOrEqual(2)
  })

  it('includes the default permission mode in the cyclable set', () => {
    // Otherwise Shift+Tab from a fresh session cannot return to the mode it
    // started in.
    expect(shipped.workspaceDefaults.cyclablePermissionModes)
      .toContain(shipped.workspaceDefaults.permissionMode)
  })
})

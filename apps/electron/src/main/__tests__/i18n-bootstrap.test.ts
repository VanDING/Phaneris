/**
 * Integration test for the main-process i18n bootstrap.
 *
 * Validates the building blocks of the regression fix:
 * - `getPersistedUiLanguage()` reads back what `setPersistedUiLanguage()` wrote.
 * - `changeAppLanguage(persisted)` — the exact call the bootstrap makes — loads
 *   the locale bundle and leaves `i18n.resolvedLanguage` matching the persisted
 *   value.
 *
 * Together these mean: if `preferences.json` has `uiLanguage: 'hu'` on disk,
 * main-process `i18n.resolvedLanguage` will be `'hu'` after the bootstrap
 * block in `apps/electron/src/main/index.ts` runs — which is the actual
 * thing that broke title generation across restarts.
 *
 * The scenario must go through `changeAppLanguage`, not the raw
 * `i18n.changeLanguage`: only English is bundled at init and every other locale
 * loads lazily, so a bare `changeLanguage('hu')` resolves to `'en'` because no
 * `hu` resource bundle exists yet. That is precisely why the helper exists, and
 * why this test asserts the bundle was loaded rather than only the language tag.
 *
 * `CONFIG_DIR` is captured at module-load, so each scenario runs in a
 * subprocess with `PHANERIS_CONFIG_DIR` set in its env (same pattern as
 * `packages/shared/src/config/__tests__/storage-startup-migration.test.ts`).
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runScript(configDir: string, script: string): RunResult {
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, PHANERIS_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('main-process i18n bootstrap', () => {
  it('hydrates main i18n from persisted uiLanguage', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'i18n-bootstrap-'))
    try {
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n, changeAppLanguage } from '@phaneris/shared/i18n';
          import { setPersistedUiLanguage, getPersistedUiLanguage } from '@phaneris/shared/config';
          setupI18n();
          setPersistedUiLanguage('hu');
          const persisted = getPersistedUiLanguage();
          // Mirrors apps/electron/src/main/index.ts:79.
          await changeAppLanguage(persisted);
          console.log(JSON.stringify({
            persisted,
            resolved: i18n.resolvedLanguage,
            bundleLoaded: i18n.hasResourceBundle('hu', 'translation'),
          }));
        `,
      )
      expect(r.exitCode).toBe(0)
      const parsed = JSON.parse(r.stdout)
      expect(parsed).toEqual({ persisted: 'hu', resolved: 'hu', bundleLoaded: true })
      expect(existsSync(join(configDir, 'preferences.json'))).toBe(true)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('returns undefined when no language is persisted (no hydration step)', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'i18n-bootstrap-'))
    try {
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '@phaneris/shared/i18n';
          import { getPersistedUiLanguage } from '@phaneris/shared/config';
          setupI18n();
          const persisted = getPersistedUiLanguage();
          console.log(JSON.stringify({ persisted: persisted ?? null, resolved: i18n.resolvedLanguage }));
        `,
      )
      expect(r.exitCode).toBe(0)
      const { persisted, resolved } = JSON.parse(r.stdout)
      expect(persisted).toBeNull()
      // Without LanguageDetector and without a hydration call, main-process i18n
      // sits at fallbackLng — which is what made title generation default to English.
      expect(resolved).toBe('en')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('ignores invalid persisted codes (defensive read)', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'i18n-bootstrap-'))
    try {
      writeFileSync(
        join(configDir, 'preferences.json'),
        JSON.stringify({ uiLanguage: 'xx' }),
        'utf-8',
      )
      const r = runScript(
        configDir,
        `
          import { getPersistedUiLanguage } from '@phaneris/shared/config';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `,
      )
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout)).toEqual({ value: null })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})

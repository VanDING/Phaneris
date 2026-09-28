/**
 * Contract tests for the single-root rule (OSS #1062).
 *
 * `CONFIG_DIR` is the one place that decides where application state lives;
 * every other module joins onto it instead of joining `homedir()` with a
 * directory literal. These tests pin the resolver's contract against an
 * injected environment — they never mutate `process.env` — so a second,
 * hardcoded root cannot reappear unnoticed.
 *
 * The resolver is pure by construction, so nothing here points at the real
 * legacy directory: doing so would only emit the (once-per-process) legacy-root
 * notice. The one test that does exercise a legacy root runs in a subprocess.
 */
import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DATA_DIR_NAME, LEGACY_IDENTITY } from '../../identity.generated.ts';
import { CONFIG_DIR, CONFIG_DIR_ENV_VAR, resolveConfigDir, warnIfLegacyRoot } from '../paths.ts';

/** A home that is never the real one, so no test can touch live state. */
const HOME = join('/Users', 'me');
const PATHS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'paths.ts')).href;

describe('resolveConfigDir', () => {
  it('defaults to <home>/.phaneris when the override is absent, empty or blank', () => {
    const fallback = join(HOME, DATA_DIR_NAME);
    expect(resolveConfigDir({}, HOME)).toBe(fallback);
    expect(resolveConfigDir({ [CONFIG_DIR_ENV_VAR]: '' }, HOME)).toBe(fallback);
    expect(resolveConfigDir({ [CONFIG_DIR_ENV_VAR]: '   ' }, HOME)).toBe(fallback);
  });

  it('honors the override and trims it', () => {
    expect(resolveConfigDir({ [CONFIG_DIR_ENV_VAR]: '/tmp/phaneris-dev' }, HOME)).toBe('/tmp/phaneris-dev');
    expect(resolveConfigDir({ [CONFIG_DIR_ENV_VAR]: ' /tmp/phaneris-dev ' }, HOME)).toBe('/tmp/phaneris-dev');
  });

  it('is pure — resolution itself emits no legacy-root warning', () => {
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      // Both forms the notice reacts to: the legacy directory name on its own,
      // and that name under a home directory.
      expect(resolveConfigDir({ [CONFIG_DIR_ENV_VAR]: LEGACY_IDENTITY.dataDirName }, HOME)).toBe(
        LEGACY_IDENTITY.dataDirName,
      );
      expect(resolveConfigDir({ [CONFIG_DIR_ENV_VAR]: join(HOME, LEGACY_IDENTITY.dataDirName) }, HOME)).toBe(
        join(HOME, LEGACY_IDENTITY.dataDirName),
      );
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings).toEqual([]);
  });

  it('CONFIG_DIR is the resolver evaluated against the real environment', () => {
    expect(CONFIG_DIR).toBe(resolveConfigDir(process.env, homedir()));
  });
});

describe('warnIfLegacyRoot', () => {
  it('warns on the resolved legacy root, in a process that evaluates CONFIG_DIR', () => {
    // The notice is emitted once per process at CONFIG_DIR evaluation, so the
    // only honest way to observe it is a fresh process pointed at the legacy
    // root. `homedir()` is computed in the child exactly as it is here.
    const legacyRoot = join(homedir(), LEGACY_IDENTITY.dataDirName);
    const run = Bun.spawnSync(
      [process.execPath, '--eval', `import { CONFIG_DIR } from '${PATHS_MODULE_PATH}'; console.log(CONFIG_DIR);`],
      {
        env: { ...process.env, [CONFIG_DIR_ENV_VAR]: legacyRoot },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe(legacyRoot);
    const stderr = run.stderr.toString();
    expect(stderr).toContain(CONFIG_DIR_ENV_VAR);
    expect(stderr).toContain('upstream application');
  });

  it('ignores a root that is not the legacy directory', () => {
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      warnIfLegacyRoot(join(HOME, DATA_DIR_NAME));
      warnIfLegacyRoot('/tmp/phaneris-dev');
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings).toEqual([]);
  });
});

/**
 * Version resolution — read from `package.json`, the single source of truth.
 *
 * The same value lives in every workspace `package.json` and in `bun.lock`,
 * because three different consumers read three different copies:
 * electron-builder stamps artifacts from `apps/electron/package.json`, the app
 * reports the one below, and `bun install --frozen-lockfile` compares the
 * lockfile. `scripts/check-versions.ts` fails if any of them diverge.
 *
 * This module previously also exported an install/update path — `install`,
 * `checkAndUpdate`, `isUpToDate`, `getUpdateToVersion` — that fetched a version
 * manifest from the upstream release service and downloaded binaries from it.
 * None of it had a caller: `getAppVersion` below is the only export anything in
 * the repository imports, and `getCurrentVersion` reported a hardcoded "0.0.1"
 * because the build-time `PHANERIS_AGENT_CLI_VERSION` it read was never defined
 * by any script. It is removed rather than left in place, because a
 * plausible-looking entry point that silently lies about the current version is
 * worse than no entry point.
 */

import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;

export function getAppVersion(): string {
  return APP_VERSION;
}

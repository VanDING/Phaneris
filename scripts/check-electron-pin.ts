#!/usr/bin/env bun
/**
 * check-electron-pin.ts — the packaged Electron runtime must match the
 * `electron` dependency.
 *
 * `apps/electron/electron-builder.yml` carries a literal `electronVersion`, and
 * electron-builder uses that literal rather than resolving the range in
 * package.json. Nothing tied the two together, so bumping the dependency while
 * leaving the pin behind produced an installer that still carried the previous
 * runtime — the dependency audit's Electron upgrade would have looked applied
 * while shipping 44.4.3.
 *
 * Also asserts the resolved `electron` version satisfies the declared range, so
 * a stale lockfile cannot pass unnoticed either.
 *
 * Usage:
 *   bun run scripts/check-electron-pin.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';

const ROOT = join(import.meta.dir, '..');
const BUILDER_YML = join(ROOT, 'apps', 'electron', 'electron-builder.yml');
const ELECTRON_PKG = join(ROOT, 'node_modules', 'electron', 'package.json');

const failures: string[] = [];

const yml = readFileSync(BUILDER_YML, 'utf8');
const pinned = yml.match(/^electronVersion:\s*"?([^"\s]+)"?\s*$/m)?.[1];
if (!pinned) {
  failures.push(`${BUILDER_YML} has no electronVersion entry; the packaged runtime would be implicit.`);
}

const installed = JSON.parse(readFileSync(ELECTRON_PKG, 'utf8')).version as string;
const declared = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies ?? {})['electron'] as
  | string
  | undefined;
if (!declared) failures.push('package.json declares no electron devDependency.');

if (pinned && installed && pinned !== installed) {
  failures.push(
    `electron-builder.yml pins electronVersion ${pinned}, but the installed electron is ${installed}. ` +
      'electron-builder uses the literal, so the installer would ship the wrong runtime.',
  );
}

if (declared && installed && !semver.satisfies(installed, declared)) {
  failures.push(`package.json declares electron "${declared}" but ${installed} is installed.`);
}

if (failures.length > 0) {
  console.error('Electron pin check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Electron pin OK: installer and dependency both at ${installed} (package.json "${declared}").`);

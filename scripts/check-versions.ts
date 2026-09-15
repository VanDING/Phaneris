#!/usr/bin/env bun
/**
 * check-versions.ts — one version across the whole workspace.
 *
 * The version lives in fifteen places: the root `package.json`, one per
 * workspace package, and every workspace entry in `bun.lock`. Nothing tied them
 * together, so they could drift silently — and they are not equally harmless
 * when they do:
 *
 *   - `packages/shared/package.json` is the runtime source of truth
 *     (`src/version/index.ts` imports it), so the app *reports* that one.
 *   - `apps/electron/package.json` is what electron-builder stamps onto the
 *     artifacts, so the installer *carries* that one.
 *   - `bun.lock` is what `bun install --frozen-lockfile` compares against, so a
 *     mismatch there breaks the documented install path for everyone else.
 *
 * Divergence between the first two is the dangerous case: the app would tell the
 * user it is one version while shipping as another, and an update check compares
 * the wrong number.
 *
 * Usage:
 *   bun run scripts/check-versions.ts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const WORKSPACE_PARENTS = ['apps', 'packages'];

/** The same discovery rule the workspace test runner uses. */
function workspaceDirs(): string[] {
  const dirs: string[] = [];
  for (const parent of WORKSPACE_PARENTS) {
    const parentDir = join(ROOT, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(parentDir, entry.name);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

interface Holder {
  /** Repo-relative path, for the report. */
  label: string;
  version: string;
}

function readVersion(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Versions recorded in `bun.lock`.
 *
 * Line-based on purpose. The lockfile is JSONC (trailing commas), so a strict
 * parse fails and a comma-stripping pass could corrupt a string; but the file's
 * shape is machine-generated and stable — a workspace's own `version` sits at
 * exactly six spaces of indentation, while dependency versions sit at eight
 * inside their objects. Matching the indentation is what distinguishes "the
 * package's version" from "the version of something it depends on".
 */
function lockfileVersions(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => /^ {6}"version":/.test(line))
    .map((line) => (line.match(/"version":\s*"([^"]*)"/) ?? [])[1] ?? '');
}

function main(): void {
  const holders: Holder[] = [];

  const rootVersion = readVersion(join(ROOT, 'package.json'));
  if (rootVersion) holders.push({ label: 'package.json', version: rootVersion });

  const dirs = workspaceDirs();
  for (const dir of dirs) {
    const version = readVersion(join(dir, 'package.json'));
    if (version) holders.push({ label: `${dir.slice(ROOT.length + 1)}/package.json`, version });
  }

  const lockVersions = lockfileVersions(join(ROOT, 'bun.lock'));
  lockVersions.forEach((version, index) => {
    holders.push({ label: `bun.lock workspace #${index + 1}`, version });
  });

  const distinct = [...new Set(holders.map((holder) => holder.version))].sort();

  if (holders.length === 0) {
    console.error('No package versions found — is this the repository root?');
    process.exit(1);
  }

  if (distinct.length > 1) {
    console.error(`Version drift: ${distinct.length} distinct versions across ${holders.length} declarations.\n`);
    for (const version of distinct) {
      console.error(`  ${version}`);
      for (const holder of holders.filter((h) => h.version === version)) {
        console.error(`    ${holder.label}`);
      }
    }
    console.error(
      '\nSet every one of them to the same value. The runtime reports' +
        ' packages/shared/package.json, electron-builder stamps apps/electron/package.json,' +
        ' and bun.lock must be regenerated with `bun install` or --frozen-lockfile breaks.',
    );
    process.exit(1);
  }

  // A missing lockfile entry is not drift, but it does mean the documented
  // install path will refuse to run.
  if (lockVersions.length !== dirs.length) {
    console.error(
      `bun.lock records ${lockVersions.length} workspace version(s) but ${dirs.length} workspace(s) exist.\n` +
        'Run `bun install` to regenerate it.',
    );
    process.exit(1);
  }

  console.log(`Version OK — ${distinct[0]} across ${holders.length} declarations (${dirs.length} workspace packages).`);
}

main();

#!/usr/bin/env bun
/**
 * migrate-legacy-profile.ts — one-off, same-machine move of a Craft Agents data
 * directory to the Phaneris one.
 *
 * This is deliberately NOT the import engine described in the fork plan (§6).
 * That design exists to migrate *other people's* machines safely: staging next
 * to the target, a resumable state machine, conflict reports, pause/resume of
 * automations, credential re-encryption for a different machine id. For a single
 * known machine, performed once, with the source application retired afterwards,
 * all of that machinery is ceremony around two operations: copy, and fix the
 * paths that point at the old root.
 *
 * What it does NOT do, and why that is acceptable here:
 *   - It does not touch the source directory at all. It is read-only on the
 *     source; the old profile stays exactly as it was, so the move is reversible
 *     by deleting the target and pointing PHANERIS_CONFIG_DIR back.
 *   - It does not re-encrypt credentials. The vault's on-disk format
 *     (`CRAFT01` magic, `craft-agent-v2` PBKDF2 label) and the machine-derived
 *     key are unchanged by the fork, so the file keeps working on this machine.
 *     It would NOT work on a different machine, and this script does not try.
 *   - It does not need the source application stopped in order to read, but the
 *     SQLite runtime database must not be mid-write when it is copied. Stop the
 *     app first; the script refuses to run while it can see a live server lock.
 *
 * Deliberately left alone:
 *   - Execution history. `runtime/runtime.db` records tool-call arguments and
 *     outputs that mention the old root tens of thousands of times; that is a
 *     ledger of what happened, and rewriting it would falsify the record.
 *   - Conversation content, `long_responses/`, session `data/`, artifact files.
 *     Their bytes are the user's material, not configuration; the fork plan
 *     forbids blanket-replacing them.
 *   - Regenerable state: caches, logs, `config.json.bak-*`, `.server.lock`.
 *
 * Usage:
 *   bun run scripts/migrate-legacy-profile.ts                 # dry run (default)
 *   bun run scripts/migrate-legacy-profile.ts --apply
 *   bun run scripts/migrate-legacy-profile.ts --apply --source <dir> --target <dir>
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

import { DATA_DIR_NAME, LEGACY_IDENTITY } from '../packages/shared/src/identity.generated.ts';

const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');
const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const HOME = homedir();
const SOURCE = argValue('--source') ?? join(HOME, LEGACY_IDENTITY.dataDirName);
const TARGET = argValue('--target') ?? join(HOME, DATA_DIR_NAME);

/** Both separator styles, because stored paths use `\` on Windows and `/` elsewhere. */
const pathForms = (root: string): string[] => [root, root.replace(/\\/g, '/')];

const OLD_FORMS = [...pathForms(SOURCE)];
const NEW_FORMS = [...pathForms(TARGET)];
const OLD_PORTABLE = `~${SOURCE.slice(HOME.length)}`;
const NEW_PORTABLE = `~${TARGET.slice(HOME.length)}`;

const REWRITES: Array<[string, string]> = [
  ...OLD_FORMS.map((from, index) => [from, NEW_FORMS[index]!] as [string, string]),
  ...pathForms(OLD_PORTABLE).map((from, index) => [from, pathForms(NEW_PORTABLE)[index]!] as [string, string]),
];

/** Rewrite every occurrence of the old root in a string. */
function fixPaths(value: string): string {
  let result = value;
  for (const [from, to] of REWRITES) {
    if (from && result.includes(from)) result = result.split(from).join(to);
  }
  return result;
}

/**
 * Keys whose string values are filesystem locations.
 *
 * The allowlist is the point: a blanket replace inside a JSON document would
 * also rewrite work-item text or page content that merely mentions the path,
 * and those are the user's words.
 */
const PATH_KEY = /(path|dir|cwd|root|folder|file|args|command|script|entry|target)$/i;

/**
 * A value that *is* a path rather than prose mentioning one.
 *
 * Needed because live paths also hide in places no key name announces — an MCP
 * source keeps its `server.py` in `mcp.args[0]`, and missing it would silently
 * break a working source. Anchoring on the start of the string separates those
 * from sentences like an automation prompt that says "先读 C:\...\SKILL.md" or a
 * work-item title containing a path; those are content and stay untouched.
 */
function isRootedAtOldProfile(value: string): boolean {
  const trimmed = value.trimStart();
  return OLD_FORMS.some((form) => trimmed.startsWith(form)) ||
    pathForms(OLD_PORTABLE).some((form) => trimmed.startsWith(form));
}

/**
 * Subtrees that record what happened rather than what is configured.
 *
 * Work-item `events[]` keep the `before`/`after` of every edit — rewriting a
 * `before` would invent a history in which the value was always the new path.
 * The same reasoning leaves the execution ledger in `runtime/runtime.db` alone.
 */
const HISTORY_KEY = /^(events|history|changes|revisions)$/i;

function rewriteJsonValue(value: unknown, key: string | null): { value: unknown; changed: number } {
  if (typeof value === 'string') {
    const byKey = key !== null && PATH_KEY.test(key);
    if (!byKey && !isRootedAtOldProfile(value)) return { value, changed: 0 };
    const next = fixPaths(value);
    return { value: next, changed: next === value ? 0 : 1 };
  }
  if (key !== null && HISTORY_KEY.test(key)) return { value, changed: 0 };
  if (Array.isArray(value)) {
    let changed = 0;
    const next = value.map((item) => {
      const result = rewriteJsonValue(item, key);
      changed += result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === 'object') {
    let changed = 0;
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const result = rewriteJsonValue(childValue, childKey);
      changed += result.changed;
      next[childKey] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: 0 };
}

/** Regenerable or transient: cheaper to let the app recreate than to copy. */
const EXCLUDED_TOP_LEVEL = new Set(['cache', 'logs']);
const EXCLUDED_FILE = /^(\.server\.lock|api-error\.json|config\.json\.bak-)/;

interface Report {
  filesCopied: number;
  bytesCopied: number;
  filesRewritten: number;
  fieldsRewritten: number;
}

function copyTree(from: string, to: string, report: Report): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDED_TOP_LEVEL.has(entry.name) || EXCLUDED_FILE.test(entry.name)) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyTree(source, target, report);
    } else if (entry.isFile()) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      report.filesCopied += 1;
      report.bytesCopied += statSync(source).size;
    }
  }
}

/** Rewrite only the structured first line of a JSONL file, leaving content intact. */
function rewriteJsonlHeader(file: string, report: Report): void {
  const text = readFileSync(file, 'utf-8');
  const newline = text.indexOf('\n');
  const head = newline === -1 ? text : text.slice(0, newline);
  if (!head.includes(LEGACY_IDENTITY.dataDirName)) return;
  const fixed = fixPaths(head);
  if (fixed === head) return;
  writeFileSync(file, fixed + (newline === -1 ? '' : text.slice(newline)), 'utf-8');
  report.filesRewritten += 1;
  report.fieldsRewritten += 1;
}

function rewriteJsonFile(file: string, report: Report): void {
  const text = readFileSync(file, 'utf-8');
  if (!text.includes(LEGACY_IDENTITY.dataDirName)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const { value, changed } = rewriteJsonValue(parsed, null);
  if (changed === 0) return;
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  report.filesRewritten += 1;
  report.fieldsRewritten += changed;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

if (!existsSync(SOURCE)) {
  console.error(`source not found: ${SOURCE}`);
  process.exit(1);
}
if (basename(SOURCE) !== LEGACY_IDENTITY.dataDirName) {
  console.error(`refusing to run: ${SOURCE} does not look like a legacy profile`);
  process.exit(1);
}
if (existsSync(join(SOURCE, '.server.lock'))) {
  const lock = readFileSync(join(SOURCE, '.server.lock'), 'utf-8');
  let holder = '';
  try {
    const { pid, execName } = JSON.parse(lock) as { pid?: number; execName?: string };
    if (pid !== undefined) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      holder = `\n  lock holder pid ${pid}${execName ? ` (${execName})` : ''} — ${alive ? 'STILL RUNNING' : 'no longer running'}`;
    }
  } catch {
    /* unreadable lock: fall back to the raw contents below */
  }
  console.warn(
    `warning: ${join(SOURCE, '.server.lock')} exists; the app writes ${join(SOURCE, 'runtime', 'runtime.db')} while running.${holder}\n` +
      `  Stop it before --apply — copying a database mid-write is how a migration loses a WAL.`,
  );
}

/**
 * Only regenerable leftovers are tolerated in the target: the application
 * recreates its own cache and log directories, so refusing on those would block
 * a migration over an empty `logs/` that some earlier run happened to create.
 */
const TOLERATED_IN_TARGET = new Set(['cache', 'logs']);
function leftoverInTarget(dir: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (TOLERATED_IN_TARGET.has(entry.name)) continue;
      return join(entry.name, leftoverInTarget(join(dir, entry.name)) ?? '');
    }
    return entry.name;
  }
  return null;
}

if (existsSync(TARGET)) {
  const leftover = leftoverInTarget(TARGET);
  if (leftover !== null) {
    console.error(
      `refusing to run: ${TARGET} already contains ${leftover}\n` +
        `  The migration never merges into an existing profile — move that directory aside first.`,
    );
    process.exit(1);
  }
}

console.log(`mode    : ${APPLY ? 'APPLY' : 'dry run (pass --apply to write)'}`);
console.log(`source  : ${SOURCE}`);
console.log(`target  : ${TARGET}`);
console.log(`excluded: ${[...EXCLUDED_TOP_LEVEL].join(', ')}, ${EXCLUDED_FILE.source}\n`);

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const report: Report = { filesCopied: 0, bytesCopied: 0, filesRewritten: 0, fieldsRewritten: 0 };

if (APPLY) {
  mkdirSync(TARGET, { recursive: true });
  copyTree(SOURCE, TARGET, report);
  console.log(`copied ${report.filesCopied} files (${(report.bytesCopied / 1024 ** 3).toFixed(2)} GB)`);
} else {
  // Dry run: measure without writing.
  const measure = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_TOP_LEVEL.has(entry.name) || EXCLUDED_FILE.test(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) measure(full);
      else if (entry.isFile()) {
        report.filesCopied += 1;
        report.bytesCopied += statSync(full).size;
      }
    }
  };
  measure(SOURCE);
  console.log(`would copy ${report.filesCopied} files (${(report.bytesCopied / 1024 ** 3).toFixed(2)} GB)`);
}

// ---------------------------------------------------------------------------
// Rewrite the live path fields
// ---------------------------------------------------------------------------

const scanRoot = APPLY ? TARGET : SOURCE;
const targets: Array<{ file: string; kind: 'jsonl' | 'json' }> = [];
for (const file of walkFiles(scanRoot)) {
  const rel = relative(scanRoot, file);
  if (rel.includes('runtime') || rel.includes('long_responses')) continue;
  if (file.endsWith('session.jsonl') || (rel.includes('.pi-sessions') && file.endsWith('.jsonl'))) {
    targets.push({ file, kind: 'jsonl' });
  } else if (file.endsWith('.json')) {
    targets.push({ file, kind: 'json' });
  }
}

const REWRITE_FILES = targets.filter(({ file, kind }) => {
  if (kind === 'jsonl') return true;
  // Only configuration-shaped JSON. Session payloads and artifacts are content.
  const rel = relative(scanRoot, file);
  return !rel.includes(`${'sessions'}`) || rel.endsWith('session.json');
});

for (const { file, kind } of REWRITE_FILES) {
  const size = statSync(file).size;
  if (size > 32 * 1024 * 1024) continue;
  if (kind === 'jsonl') {
    if (!APPLY) {
      const head = readFileSync(file, 'utf-8').split(/\r?\n/, 1)[0] ?? '';
      if (head.includes(LEGACY_IDENTITY.dataDirName) && fixPaths(head) !== head) {
        report.filesRewritten += 1;
        report.fieldsRewritten += 1;
        if (LIST) console.log(`  jsonl header  ${relative(scanRoot, file)}`);
      }
      continue;
    }
    rewriteJsonlHeader(file, report);
  } else {
    if (!APPLY) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf-8'));
      } catch {
        continue;
      }
      const { changed } = rewriteJsonValue(parsed, null);
      if (changed > 0) {
        report.filesRewritten += 1;
        report.fieldsRewritten += changed;
        if (LIST) console.log(`  ${String(changed).padStart(3)} field(s)  ${relative(scanRoot, file)}`);
      }
      continue;
    }
    rewriteJsonFile(file, report);
  }
}

console.log(
  `${APPLY ? 'rewrote' : 'would rewrite'} ${report.fieldsRewritten} path field(s) in ${report.filesRewritten} file(s)`,
);

if (!APPLY) {
  console.log('\ndry run complete — nothing was written. Re-run with --apply to perform the move.');
  console.log('Stop the application first, and expect the first launch to re-create cache/ and logs/.');
}

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
 *   - It does NOT migrate the credential vault (`credentials.key` and
 *     `credentials.enc` are excluded). The vault's own file format is unchanged
 *     by the fork, but `credentials.key` is not a vault-format artifact: it is
 *     an OS-protected blob whose protection is bound to the application that
 *     wrote it. On Windows the blob begins with `v10` (Chromium app-bound
 *     encryption), so a renamed executable cannot unwrap it. Copying it does not
 *     preserve access — it guarantees the new app can never unwrap the key AND
 *     can never create a fresh one, so the vault fails on every read. Credentials
 *     are re-authorized once instead; the connections and sources themselves
 *     still migrate, only their secrets do not.
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
 *   bun run scripts/migrate-legacy-profile.ts --repair        # rewrite paths only
 *   bun run scripts/migrate-legacy-profile.ts --apply --source <dir> --target <dir>
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

import { DATA_DIR_NAME, LEGACY_IDENTITY } from '../packages/shared/src/identity.generated.ts';
const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');
/**
 * Run only the path-rewrite phase against an existing target.
 *
 * Safe by construction and idempotent: replacing the old root with the new one
 * does nothing to a value that already points at the new root, and this phase
 * never copies or deletes data. It exists so a correction to the rewrite rules
 * does not force a fresh multi-gigabyte copy — which is exactly the situation
 * that produced it (the first version missed backslash-escaped JSON paths).
 */
const REPAIR = process.argv.includes('--repair');
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

/**
 * The credential vault, excluded by name.
 *
 * `credentials.key` is protected by the OS in a way that is bound to the
 * application that wrote it (see the header), so carrying it over does not
 * preserve access — it only prevents the new app from creating a usable key.
 * `credentials.enc` is encrypted with that key, so it is equally unusable.
 */
const EXCLUDED_CREDENTIALS = new Set(['credentials.key', 'credentials.enc']);

interface Report {
  filesCopied: number;
  bytesCopied: number;
  filesRewritten: number;
  fieldsRewritten: number;
  /** Headers that mention the old root but are not parseable as JSON. */
  unparsedHeaders: string[];
}

function copyTree(from: string, to: string, report: Report): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDED_TOP_LEVEL.has(entry.name) || EXCLUDED_FILE.test(entry.name) || EXCLUDED_CREDENTIALS.has(entry.name)) continue;
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

/** Read at most this much to obtain a JSONL file's first line. */
const HEADER_READ_LIMIT = 4 * 1024 * 1024;

/**
 * Read a file's first line without loading the whole thing.
 *
 * Session JSONL files reach tens of megabytes of conversation, and the header
 * is the only structured part. Reading the entire file to find its first
 * newline both wasted time and forced a size ceiling that silently skipped the
 * largest sessions — leaving exactly those sessions pointing at the old root.
 */
function readFirstLine(file: string): { head: string; complete: boolean } {
  const handle = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_READ_LIMIT);
    const read = readSync(handle, buffer, 0, HEADER_READ_LIMIT, 0);
    const text = buffer.subarray(0, read).toString('utf-8');
    const newline = text.indexOf('\n');
    if (newline !== -1) return { head: text.slice(0, newline), complete: true };
    // No newline within the window: either a single-line file or a header far
    // larger than any real one. `complete` distinguishes them for later reads.
    return { head: text, complete: read < HEADER_READ_LIMIT };
  } finally {
    closeSync(handle);
  }
}

/**
 * Rewrite only the structured first line of a JSONL file, leaving content intact.
 *
 * Parsed rather than textually substituted, and that distinction is the whole
 * point: a Windows path inside JSON is escaped (`~\\\\.craft-agent\\\\workspaces`),
 * so a search for the literal single-backslash path never matches the raw line.
 * A textual pass therefore fixed only the forward-slash values (`~/.craft-agent`)
 * and silently left every `workspaceRootPath` and `cwd` pointing at the old
 * root — which is exactly the field session resume depends on. Parsing the line
 * also guarantees the conversation on line 2..n can never be touched.
 */
function rewriteJsonlHeader(file: string, report: Report): void {
  const { head } = readFirstLine(file);
  if (!head.includes(LEGACY_IDENTITY.dataDirName)) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(head);
  } catch {
    report.unparsedHeaders.push(file);
    return;
  }
  const { value, changed } = rewriteJsonValue(parsed, null);
  if (changed === 0) return;

  // Splice the rewritten header back over the original bytes, so the rest of
  // the file is copied through untouched rather than re-serialised.
  const original = readFileSync(file);
  const headerBytes = Buffer.byteLength(head, 'utf-8');
  const rewritten = Buffer.from(JSON.stringify(value), 'utf-8');
  writeFileSync(file, Buffer.concat([rewritten, original.subarray(headerBytes)]));
  report.filesRewritten += 1;
  report.fieldsRewritten += changed;
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

if (REPAIR) {
  if (!existsSync(TARGET)) {
    console.error(`refusing to run: --repair needs an existing target at ${TARGET}`);
    process.exit(1);
  }
} else if (existsSync(TARGET)) {
  const leftover = leftoverInTarget(TARGET);
  if (leftover !== null) {
    console.error(
      `refusing to run: ${TARGET} already contains ${leftover}\n` +
        `  The migration never merges into an existing profile — move that directory aside first.\n` +
        `  (To re-run only the path rewrite on this target, use --repair.)`,
    );
    process.exit(1);
  }
}

console.log(`mode    : ${REPAIR ? 'REPAIR (rewrite paths only)' : APPLY ? 'APPLY' : 'dry run (pass --apply to write)'}`);
console.log(`source  : ${SOURCE}`);
console.log(`target  : ${TARGET}`);
console.log(`excluded: ${[...EXCLUDED_TOP_LEVEL].join(', ')}, ${[...EXCLUDED_CREDENTIALS].join(', ')}, ${EXCLUDED_FILE.source}\n`);

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const report: Report = {
  filesCopied: 0,
  bytesCopied: 0,
  filesRewritten: 0,
  fieldsRewritten: 0,
  unparsedHeaders: [],
};

if (REPAIR) {
  console.log('repair: leaving the existing copy in place, rewriting paths only\n');
} else if (APPLY) {
  mkdirSync(TARGET, { recursive: true });
  copyTree(SOURCE, TARGET, report);
  console.log(`copied ${report.filesCopied} files (${(report.bytesCopied / 1024 ** 3).toFixed(2)} GB)`);
} else {
  // Dry run: measure without writing.
  const measure = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_TOP_LEVEL.has(entry.name) || EXCLUDED_FILE.test(entry.name) || EXCLUDED_CREDENTIALS.has(entry.name)) continue;
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

/** Writes happen only with --apply; --repair just skips the copy phase. */
const writing = APPLY;
const scanRoot = APPLY || REPAIR ? TARGET : SOURCE;
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
  if (kind === 'jsonl') {
    // Bounded head read: a session file's conversation can be tens of megabytes
    // and the header is the only structured part. A whole-file read here is what
    // previously forced a size ceiling that skipped the largest sessions.
    const { head } = readFirstLine(file);
    if (!head.includes(LEGACY_IDENTITY.dataDirName)) continue;
    if (!writing) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(head);
      } catch {
        report.unparsedHeaders.push(file);
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
    rewriteJsonlHeader(file, report);
  } else {
    if (statSync(file).size > 32 * 1024 * 1024) continue;
    if (!writing) {
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
  `${writing ? 'rewrote' : 'would rewrite'} ${report.fieldsRewritten} path field(s) in ${report.filesRewritten} file(s)`,
);

if (report.unparsedHeaders.length > 0) {
  console.warn(
    `\nwarning: ${report.unparsedHeaders.length} session header(s) mention the old root but are not JSON; ` +
      `they were left alone, so those sessions would resume in the old directory:`,
  );
  for (const file of report.unparsedHeaders.slice(0, 10)) console.warn(`  ${file}`);
}

if (!writing) {
  console.log('\ndry run complete — nothing was written. Re-run with --apply to perform the move.');
  console.log('Stop the application first, and expect the first launch to re-create cache/ and logs/.');
}

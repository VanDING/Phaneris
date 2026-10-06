#!/usr/bin/env bun
/**
 * Documentation gate.
 *
 * Enforces the three things `docs/README.md` promises but nothing checked:
 *
 *   1. Every relative link (and link to a repo file) inside `docs/**\/*.md` resolves.
 *   2. Every document declares a status, and every `docs/architecture/*.md` uses one of the
 *      five words maintenance rule 2 requires (proposed | accepted | deferred | superseded | historical).
 *   3. Every document is reachable from the `docs/README.md` index.
 *
 * Rationale: these three failures accumulated silently (28 broken links, 7 statuses that
 * contradicted the code, 34 unregistered documents) because no gate looked at `docs/`.
 *
 * Usage:
 *   bun run check:docs
 *   bun run check:docs --json
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const DOCS = join(ROOT, 'docs');
const INDEX = join(DOCS, 'README.md');

/** Directories whose markdown is generated or vendored, not maintained here. */
const IGNORED_DIRS = new Set(['.git', 'node_modules']);

/**
 * Maintenance rule 2 vocabulary. Rule 2 is scoped to *architecture* documents, so only
 * `docs/architecture/*.md` is required to declare one of these words in-file. Every other
 * document's classification lives in the index (`docs/README.md`), which is what check 3 covers.
 */
const ARCHITECTURE_STATUS_WORDS = ['proposed', 'accepted', 'deferred', 'superseded', 'historical'];
const STATUS_SCAN_LINES = 20;

const MD_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

interface DocFile {
  abs: string;
  rel: string; // repo-relative, posix
  text: string;
  lines: string[];
}

function posix(p: string): string {
  return p.split(sep).join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const docs: DocFile[] = walk(DOCS)
  .sort()
  .map((abs) => {
    const text = readFileSync(abs, 'utf8');
    return { abs, rel: posix(relative(ROOT, abs)), text, lines: text.split(/\r?\n/) };
  });

const failures: string[] = [];
const warnings: string[] = [];

// ---------------------------------------------------------------------------
// 1. links resolve
// ---------------------------------------------------------------------------
let linkCount = 0;
for (const doc of docs) {
  let match: RegExpExecArray | null;
  MD_LINK.lastIndex = 0;
  while ((match = MD_LINK.exec(doc.text))) {
    const raw = match[1]!;
    if (/^(https?:|mailto:|tel:|#|data:)/.test(raw)) continue;
    const withoutHash = raw.split('#')[0]!;
    if (!withoutHash) continue;
    linkCount++;

    // Reject machine-specific absolute paths (the class of bug that produced 28 dead links).
    if (/^[A-Za-z]:[\\/]/.test(withoutHash) || withoutHash.startsWith('file://')) {
      failures.push(`${doc.rel}: absolute machine path in link -> ${raw}`);
      continue;
    }
    if (withoutHash.startsWith('/')) {
      failures.push(`${doc.rel}: root-absolute link (not portable) -> ${raw}`);
      continue;
    }

    const target = resolve(dirname(doc.abs), decodeURIComponent(withoutHash));
    if (!existsSync(target)) {
      failures.push(`${doc.rel}: broken link -> ${raw}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. architecture documents declare rule-2 vocabulary
// ---------------------------------------------------------------------------
/**
 * A status *declaration*, not the word appearing in prose. Requires an explicit
 * `Status:` / `状态：` line (optionally Markdown-decorated) carrying one of the five words.
 * Matching bare words would pass documents that merely say "historical messages".
 */
const STATUS_LINE = /^[\s>*_-]*(?:\*\*)?\s*(?:status|状态)\s*(?:\*\*)?\s*[:：]\s*(.+)$/i;

for (const doc of docs) {
  if (!doc.rel.startsWith('docs/architecture/')) continue;
  const head = doc.lines.slice(0, STATUS_SCAN_LINES);
  const declarations = head
    .map((line) => STATUS_LINE.exec(line)?.[1] ?? null)
    .filter((v): v is string => v !== null);
  const declares = declarations.some((value) =>
    ARCHITECTURE_STATUS_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(value)),
  );
  if (!declares) {
    failures.push(
      `${doc.rel}: architecture document must declare one of ${ARCHITECTURE_STATUS_WORDS.join(' | ')} ` +
        `on an explicit \`Status:\` line in the first ${STATUS_SCAN_LINES} lines (maintenance rule 2)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. every document is reachable from the docs/README.md index
//    (directly, or via a subdirectory README that indexes its own folder)
// ---------------------------------------------------------------------------
const indexDoc = docs.find((d) => d.abs === INDEX);
if (!indexDoc) {
  failures.push('docs/README.md is missing');
} else {
  const byAbs = new Map(docs.map((d) => [d.abs, d]));
  const reached = new Set<string>([INDEX]);
  const queue: DocFile[] = [indexDoc];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let match: RegExpExecArray | null;
    MD_LINK.lastIndex = 0;
    while ((match = MD_LINK.exec(current.text))) {
      const raw = match[1]!;
      if (/^(https?:|mailto:|#)/.test(raw)) continue;
      const withoutHash = raw.split('#')[0]!;
      if (!withoutHash) continue;
      const target = resolve(dirname(current.abs), decodeURIComponent(withoutHash));
      if (!byAbs.has(target) || reached.has(target)) continue;
      reached.add(target);
      queue.push(byAbs.get(target)!);
    }
  }
  for (const doc of docs) {
    if (reached.has(doc.abs)) continue;
    failures.push(`${doc.rel}: not reachable from docs/README.md`);
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ documents: docs.length, links: linkCount, failures, warnings }, null, 2));
} else {
  console.log(`check:docs — ${docs.length} documents, ${linkCount} relative links checked.`);
  for (const w of warnings) console.warn(`  warn  ${w}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} documentation problem(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nFix the documents, not this gate.');
    process.exit(1);
  }
  console.log('Documentation gate OK.');
}

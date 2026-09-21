#!/usr/bin/env bun
/**
 * check-transition-all.ts — gate for unbounded CSS transitions across every UI entry.
 *
 * `transition-all` (Tailwind) and `transition: all` (CSS) animate whatever
 * property happens to change next, including layout and paint properties that
 * were never considered when the transition was written. Product code must name
 * the properties it animates.
 *
 * The ESLint rule in scripts/eslint-rules/no-transition-all.cjs only sees JS/TS
 * string literals inside packages that have an ESLint config. That leaves the
 * gaps this script closes:
 *
 *   - plain CSS files (Tailwind utilities cannot express a bare `transition: all`)
 *   - inline <style> blocks in entry HTML
 *   - entries without an ESLint config (apps/webui, apps/viewer)
 *
 * Every rendered entry is listed in SCAN_ROOTS, so covering a new one means
 * adding a root here rather than standing up another lint config.
 *
 * Usage:
 *   bun run scripts/check-transition-all.ts            scan and report
 *   bun run scripts/check-transition-all.ts --json     machine-readable report
 *
 * Exit code 1 when any unapproved hit remains.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');

/** UI source roots. Every rendered entry must appear here. */
const SCAN_ROOTS = [
  'apps/electron/src',
  'apps/webui/src',
  'apps/viewer/src',
  'packages/ui/src',
];

const SCRIPT_EXTENSIONS: Record<string, true> = {
  '.ts': true,
  '.tsx': true,
  '.js': true,
  '.jsx': true,
  '.mjs': true,
  '.cjs': true,
};

const MARKUP_EXTENSIONS: Record<string, true> = {
  '.css': true,
  '.html': true,
  '.htm': true,
};

/** Never contain first-party source. */
const IGNORED_DIRECTORIES: Record<string, true> = {
  node_modules: true,
  dist: true,
  release: true,
  out: true,
  build: true,
  '.vite': true,
};

/**
 * The Playground previews component interaction and intentionally exercises
 * transitions the product would not ship; it is already exempt from the
 * equivalent ESLint rule in apps/electron/eslint.config.mjs.
 */
const EXEMPT_DIRECTORIES: Record<string, true> = { playground: true };

interface Hit {
  file: string;
  line: number;
  column: number;
  text: string;
  kind: 'class-utility' | 'css-transition';
}

/** `transition-all` as a whole class token, mirroring the ESLint rule's boundary check. */
const CLASS_UTILITY = /(^|[\s"'`])transition-all(?=[\s"'`]|$)/g;

/** `transition: all ...` and `transition-property: all`. */
const CSS_TRANSITION_ALL = /transition(?:-property)?\s*:\s*all\b/g;

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES[entry.name] || EXEMPT_DIRECTORIES[entry.name]) continue;
      collectFiles(join(dir, entry.name), out);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const extension = dot === -1 ? '' : entry.name.slice(dot);
    if (SCRIPT_EXTENSIONS[extension] || MARKUP_EXTENSIONS[extension]) out.push(join(dir, entry.name));
  }
}

function scanFile(path: string, relativePath: string): Hit[] {
  const hits: Hit[] = [];
  // Comments explain why the token is banned and must not trip the gate. Both
  // comment forms are blanked in place (newlines and spacing kept) so reported
  // positions still point at the real source. The `[^:]` guard protects the
  // `//` of a URL inside a string literal.
  const source = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix: string) => prefix + ' '.repeat(match.length - prefix.length));
  const extension = path.slice(path.lastIndexOf('.'));

  // Counted per hit instead of precomputing a line table: a gate run has few
  // hits and this keeps the offset arithmetic in one place.
  const addHits = (pattern: RegExp, kind: Hit['kind']) => {
    for (const match of source.matchAll(pattern)) {
      const offset = match.index! + match[0].length - match[0].trimStart().length;
      hits.push({
        file: relativePath,
        line: source.slice(0, offset).split('\n').length,
        column: offset - source.lastIndexOf('\n', offset - 1),
        text: match[0].trim(),
        kind,
      });
    }
  };

  if (MARKUP_EXTENSIONS[extension]) {
    addHits(CSS_TRANSITION_ALL, 'css-transition');
    // Entry HTML can also carry the utility in a class attribute.
    if (extension !== '.css') addHits(CLASS_UTILITY, 'class-utility');
    return hits;
  }

  addHits(CLASS_UTILITY, 'class-utility');
  // A `transition: all` inside a JS/TS string (styled-jsx, inline styles) counts.
  addHits(CSS_TRANSITION_ALL, 'css-transition');
  return hits;
}

const hits: Hit[] = [];
const files: string[] = [];

for (const root of SCAN_ROOTS) {
  const absolute = join(ROOT, root);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    console.error(`transition-all: missing scan root ${root}`);
    process.exit(1);
  }
  if (!stats.isDirectory()) continue;
  const rootFiles: string[] = [];
  collectFiles(absolute, rootFiles);
  for (const path of rootFiles) {
    files.push(path);
    hits.push(...scanFile(path, relative(ROOT, path).split(sep).join('/')));
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned: files.length, hits }, null, 2));
} else if (hits.length === 0) {
  console.log(`transition-all: clean (${files.length} files scanned)`);
} else {
  console.error(
    `transition-all: ${hits.length} unbounded transition(s) in ${new Set(hits.map((hit) => hit.file)).size} file(s)`,
  );
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}:${hit.column}  ${hit.text}`);
  console.error('');
  console.error('Name the animated properties (transition-colors, transition-opacity,');
  console.error('transition-[width], or `transition: border-color 200ms ease`).');
}

if (hits.length) process.exit(1);

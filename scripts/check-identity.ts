#!/usr/bin/env bun
/**
 * check-identity.ts — CI gate for the Phaneris rebrand.
 *
 * Two independent checks:
 *
 * 1. DRIFT (always fatal). `packages/shared/src/identity.generated.ts` and
 *    `apps/electron/identity.generated.yml` are re-rendered in memory and
 *    compared with what is on disk, so a hand-edited generated file or a
 *    changed `phaneris.identity.json` without a regenerate both fail.
 *    It also asserts `apps/electron/electron-builder.yml` pulls its identity in
 *    via `extends` instead of restating appId/productName/copyright/artifactName.
 *
 * 2. RESIDUAL SCAN (fatal only with --strict). Walks the tracked working tree
 *    for upstream product identifiers and reports hits that no reasoned rule in
 *    `scripts/identity-allowlist.json` covers. Rules that match nothing are
 *    reported as unused so the allowlist cannot rot.
 *
 * The scan walks the filesystem rather than shelling out to `git ls-files`:
 * child processes with piped stdio are unavailable in the sandboxed dev
 * environment, and the ignore list below already excludes every build output.
 *
 * Usage:
 *   bun run identity:check             drift check + residual report (exit 0)
 *   bun run identity:check --strict    residual hits also fail the run
 *   bun run identity:check --json      machine-readable report on stdout
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ROOT, buildArtifacts, loadIdentity, IdentityError } from './identity-core.ts';

const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');
const BUILDER_CONFIG = join(ROOT, 'apps', 'electron', 'electron-builder.yml');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'identity-allowlist.json');

/** Directories that never contain first-party source or configuration. */
const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'release',
  'coverage',
  '.cache',
  '.codegraph',
  '.craft-agent',
  '.ui-refinement',
  '.turbo',
  '.vite',
  'vendor',
  '~',
]);

const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Upstream identifiers the rebrand must eliminate, or explicitly allow. */
interface BrandToken {
  id: string;
  pattern: RegExp;
  description: string;
}

const TOKENS: BrandToken[] = [
  {
    id: 'package-scope',
    pattern: /@craft-agent\//g,
    description: 'internal npm scope for workspace packages',
  },
  {
    id: 'kebab-slug',
    pattern: /craft-agent/g,
    description: 'kebab-case slug: data directory, package name, file and identifier names',
  },
  {
    id: 'display-name',
    pattern: /Craft Agents/g,
    description: 'user-visible product name',
  },
  {
    id: 'display-name-singular',
    pattern: /Craft Agent(?![s])/g,
    description: 'user-visible product name, singular form',
  },
  {
    id: 'scheme-or-domain',
    pattern: /craftagents/gi,
    description: 'deep-link scheme and the upstream hosted domain',
  },
  {
    id: 'env-prefix',
    pattern: /\bCRAFT_[A-Z0-9_]+/g,
    description: 'environment variable prefix',
  },
  {
    id: 'code-identifier',
    pattern: /CraftAgent(?![sy])|craftAgent/g,
    description: 'PascalCase/camelCase code identifiers',
  },
  {
    id: 'upstream-owner',
    pattern: /lukilabs|Craft Docs Ltd\.|craft\.do/g,
    description: 'upstream app id namespace, copyright holder and site',
  },
];

interface AllowRule {
  glob: string;
  tokens: string[];
  reason: string;
}

interface Hit {
  file: string;
  line: number;
  token: string;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_SEGMENTS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const toPosix = (value: string): string => value.split(sep).join('/');

function isBinary(path: string): boolean {
  try {
    const size = statSync(path).size;
    if (size === 0 || size > MAX_FILE_BYTES) return true;
    const probe = readFileSync(path).subarray(0, 8192);
    return probe.includes(0);
  } catch {
    return true;
  }
}

function loadAllowlist(): AllowRule[] {
  if (!existsSync(ALLOWLIST_PATH)) {
    console.error(`identity check failed: missing ${toPosix(relative(ROOT, ALLOWLIST_PATH))}`);
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8')) as { rules?: AllowRule[] };
  return parsed.rules ?? [];
}

function ruleMatches(rule: AllowRule, relPath: string, tokenId: string): boolean {
  if (rule.tokens.length && !rule.tokens.includes('*') && !rule.tokens.includes(tokenId)) return false;
  return new Bun.Glob(rule.glob).match(relPath);
}

// ---------------------------------------------------------------------------
// 1. Drift
// ---------------------------------------------------------------------------

const driftProblems: string[] = [];

let identity;
try {
  identity = loadIdentity();
} catch (error) {
  if (error instanceof IdentityError) {
    console.error(`identity check failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

for (const artifact of buildArtifacts(identity)) {
  const relPath = toPosix(relative(ROOT, artifact.path));
  if (!existsSync(artifact.path)) {
    driftProblems.push(`${relPath} is missing — run "bun run identity:generate"`);
    continue;
  }
  const onDisk = readFileSync(artifact.path, 'utf-8');
  if (onDisk !== artifact.content) {
    driftProblems.push(`${relPath} is out of date — run "bun run identity:generate"`);
  }
}

if (!existsSync(BUILDER_CONFIG)) {
  driftProblems.push('apps/electron/electron-builder.yml is missing');
} else {
  const builder = readFileSync(BUILDER_CONFIG, 'utf-8');
  const extendsMatch = /^extends:\s*(.+)$/m.exec(builder);
  if (!extendsMatch) {
    driftProblems.push(
      'apps/electron/electron-builder.yml must pull its identity in via "extends:" instead of restating it',
    );
  } else if (!extendsMatch[1]!.includes('identity.generated.yml')) {
    driftProblems.push(
      `apps/electron/electron-builder.yml extends ${extendsMatch[1]!.trim()} instead of ./identity.generated.yml`,
    );
  }
  const restated = ['appId', 'productName', 'copyright', 'artifactName'].filter((key) =>
    new RegExp(`^${key}:`, 'm').test(builder),
  );
  if (restated.length) {
    driftProblems.push(
      `apps/electron/electron-builder.yml restates identity keys (${restated.join(', ')}) — ` +
        `they belong in phaneris.identity.json`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Residual scan
// ---------------------------------------------------------------------------

const allowlist = loadAllowlist();
const usedRules = new Set<number>();
const hits: Hit[] = [];
const allowedHits: Hit[] = [];

for (const path of walk(ROOT)) {
  if (isBinary(path)) continue;
  const relPath = toPosix(relative(ROOT, path));
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const token of TOKENS) {
      token.pattern.lastIndex = 0;
      if (!token.pattern.test(line)) continue;
      const hit: Hit = { file: relPath, line: index + 1, token: token.id, text: line.trim().slice(0, 200) };
      const ruleIndex = allowlist.findIndex((rule) => ruleMatches(rule, relPath, token.id));
      if (ruleIndex >= 0) {
        usedRules.add(ruleIndex);
        allowedHits.push(hit);
      } else {
        hits.push(hit);
      }
    }
  }
}

const unusedRules = allowlist
  .map((rule, index) => ({ rule, index }))
  .filter(({ index }) => !usedRules.has(index));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const byToken = new Map<string, number>();
for (const hit of hits) byToken.set(hit.token, (byToken.get(hit.token) ?? 0) + 1);
const byFile = new Map<string, number>();
for (const hit of hits) byFile.set(hit.file, (byFile.get(hit.file) ?? 0) + 1);
const topFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        identity: identity.product,
        driftProblems,
        residual: { open: hits.length, allowed: allowedHits.length, byToken: Object.fromEntries(byToken), topFiles },
        unusedRules: unusedRules.map(({ rule }) => rule.glob),
      },
      null,
      2,
    ),
  );
} else {
  console.log(`identity: ${identity.product.name} (${identity.product.appId}, ${identity.product.scheme}://)`);

  console.log('');
  console.log('drift check');
  if (driftProblems.length === 0) {
    console.log('  OK — generated identity artifacts and packaging config are in sync');
  } else {
    for (const problem of driftProblems) console.log(`  FAIL ${problem}`);
  }

  console.log('');
  console.log('residual upstream identifiers');
  if (hits.length === 0) {
    console.log('  OK — no unallowlisted upstream identifier remains');
  } else {
    console.log(`  ${hits.length} unallowlisted hit(s) across ${byFile.size} file(s); ${allowedHits.length} allowlisted`);
    for (const token of TOKENS) {
      const count = byToken.get(token.id);
      if (count) console.log(`    ${token.id.padEnd(24)} ${String(count).padStart(5)}  ${token.description}`);
    }
    console.log('  worst files:');
    for (const [file, count] of topFiles) console.log(`    ${String(count).padStart(5)}  ${file}`);
  }

  if (unusedRules.length) {
    console.log('');
    console.log('unused allowlist rules (delete them)');
    for (const { rule } of unusedRules) console.log(`  ${rule.glob}`);
  }
}

if (driftProblems.length) process.exit(1);
if (STRICT && hits.length) {
  console.error('');
  console.error(`identity check failed (--strict): ${hits.length} unallowlisted upstream identifier(s) remain`);
  process.exit(1);
}

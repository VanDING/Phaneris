#!/usr/bin/env bun
/**
 * clear-session-shares.ts — drop published-share pointers from session headers.
 *
 * Phaneris turns conversation sharing to the hosted viewer OFF
 * (`isSessionSharingEnabled()`), and the create-share affordance is gone from
 * the UI. A profile migrated from upstream can still carry the *result* of an
 * earlier share: `sharedUrl` / `sharedId` in a session's JSONL header, pointing
 * at a host this build neither owns nor can address.
 *
 * Leaving those in place is not neutral. The header is what the session list
 * reads, so the app keeps rendering a "shared" state whose link goes to a third
 * party — and whose revoke button issues a DELETE against a host that never
 * held the record (upstream moved its viewer from agents.craft.do to
 * thecraftagents.com in v0.12.0), so revoking appears to succeed and does
 * nothing. Clearing the pointer makes the local state honest: not shared, with
 * nothing left to revoke.
 *
 * What this does NOT do, and why that is stated plainly rather than fixed:
 *   - It cannot delete the remote copy. A share URL is a capability link: it
 *     stays readable by whoever holds it, and the server that stores it is not
 *     ours. If a publication must be withdrawn, do that upstream FIRST, while
 *     you still have the link. This script deliberately never prints a full URL
 *     (a capability link in a terminal log is a capability link leaked) and
 *     records none of them anywhere.
 *   - It does not touch conversation content. Only the two header fields named
 *     above are removed; messages, attachments, and every other metadata field
 *     are written back byte-for-byte as they were.
 *
 * Idempotent: a second run finds nothing to do. Reversible only in the sense
 * that the removed value would have to be recovered from a backup — which is
 * why it defaults to a dry run.
 *
 * Usage:
 *   bun run scripts/clear-session-shares.ts                    # dry run (default)
 *   bun run scripts/clear-session-shares.ts --apply
 *   bun run scripts/clear-session-shares.ts --config <dir>
 *   bun run scripts/clear-session-shares.ts --apply --force    # ignore the lock
 */

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DATA_DIR_NAME } from '../packages/shared/src/identity.generated.ts';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const configDir = argValue('--config') ?? join(homedir(), DATA_DIR_NAME);

/**
 * The fields `updateSessionMetadata` writes for a publication. Both go: either
 * one alone is a half-cleared state that still renders as shared.
 */
const SHARE_FIELDS = ['sharedUrl', 'sharedId'] as const;

interface Hit {
  file: string;
  session: string;
  /** Host only — never the full URL. */
  host: string;
  present: string[];
  rewrite: string;
}

/** Report the host of a share URL without echoing the capability token. */
function hostOf(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '(absent)';
  try {
    return new URL(value).host;
  } catch {
    return '(unparseable)';
  }
}

/** All `session.jsonl` files under `<config>/workspaces/*\/sessions/*\/`. */
function findSessionFiles(): string[] {
  const workspacesDir = join(configDir, 'workspaces');
  if (!existsSync(workspacesDir)) return [];

  const files: string[] = [];
  for (const workspace of readdirSync(workspacesDir, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const sessionsDir = join(workspacesDir, workspace.name, 'sessions');
    if (!existsSync(sessionsDir)) continue;
    for (const session of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      const file = join(sessionsDir, session.name, 'session.jsonl');
      if (existsSync(file) && statSync(file).isFile()) files.push(file);
    }
  }
  return files;
}

/**
 * Rewrite line 1 (the header) of a JSONL session file, leaving every other byte
 * alone. The line terminator is reproduced from the original so a CRLF file does
 * not end up with a mixed-ending first line.
 */
function parseHeader(text: string, file: string): { header: Record<string, unknown>; rest: string; eol: string } {
  const firstNewline = text.indexOf('\n');
  const rawHeader = firstNewline === -1 ? text : text.slice(0, firstNewline);
  const eol = rawHeader.endsWith('\r') ? '\r' : '';
  const rest = firstNewline === -1 ? '' : text.slice(firstNewline);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawHeader);
  } catch (error) {
    throw new Error(`${file}: line 1 is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file}: line 1 is not a session header object`);
  }
  return { header: parsed as Record<string, unknown>, rest, eol };
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of findSessionFiles()) {
    const text = readFileSync(file, 'utf8');
    const { header, rest, eol } = parseHeader(text, file);

    const present = SHARE_FIELDS.filter((field) => field in header);
    if (present.length === 0) continue;

    // Read the host before the fields are removed — afterwards it is gone.
    const host = hostOf(header.sharedUrl);
    for (const field of SHARE_FIELDS) delete header[field];

    hits.push({
      file,
      session: file.slice(configDir.length + 1),
      host,
      present: [...present],
      rewrite: `${JSON.stringify(header)}${eol}${rest}`,
    });
  }
  return hits;
}

function main(): void {
  if (!existsSync(configDir)) {
    console.error(`Config directory not found: ${configDir}`);
    process.exit(1);
  }

  const lockFile = join(configDir, '.server.lock');
  if (APPLY && existsSync(lockFile) && !FORCE) {
    console.error(
      `Refusing to write: ${lockFile} exists, so a server may have these sessions\n` +
        'loaded in memory and could overwrite the edit. Close the app first, or pass --force.',
    );
    process.exit(1);
  }

  const hits = scan();
  const mode = APPLY ? 'APPLY' : 'DRY RUN';
  console.log(`[${mode}] ${configDir}`);

  if (hits.length === 0) {
    console.log('No session carries a share pointer. Nothing to do.');
    return;
  }

  for (const hit of hits) {
    console.log(`  ${hit.session}`);
    console.log(`    fields: ${hit.present.join(', ')}   host: ${hit.host}`);
  }

  if (!APPLY) {
    console.log(`\n${hits.length} session(s) would be cleared. Re-run with --apply to write.`);
    return;
  }

  for (const hit of hits) {
    const temp = `${hit.file}.clear-shares.tmp`;
    try {
      writeFileSync(temp, hit.rewrite, 'utf8');
      renameSync(temp, hit.file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
  console.log(`\nCleared ${hits.length} session header(s).`);
  console.log('The remote copies, if any, were not and cannot be deleted from here.');
}

main();

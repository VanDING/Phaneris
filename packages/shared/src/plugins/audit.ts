/**
 * Plugin audit log (P5-4).
 *
 * Installation replaces existing workspace resources without asking again (D6),
 * so the user needs a way to find out afterwards when a skill or source was
 * swapped and by what. This is deliberately minimal: one JSONL line per action,
 * appended to the existing logs directory — no new file format, no rotation
 * scheme, and nothing here may fail an install.
 *
 * Shape follows `privileged-actions.jsonl` and `page-actions.jsonl`.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOGS_DIR } from '../config/paths.ts';
import { debug } from '../utils/debug.ts';

/** Path of the plugin audit log. */
export const PLUGIN_AUDIT_LOG = join(LOGS_DIR, 'plugin-actions.jsonl');

/**
 * Resolve the audit log path at call time.
 *
 * `PHANERIS_PLUGIN_AUDIT_LOG` overrides the default so tests can write to a
 * temporary file instead of the user's real log directory.
 */
function resolveAuditLogPath(): string {
  const override = process.env.PHANERIS_PLUGIN_AUDIT_LOG;
  return override && override.trim() ? override : PLUGIN_AUDIT_LOG;
}

/** A stdio command recorded verbatim, so the log answers "what did it run?". */
export interface PluginAuditStdioCommand {
  slug: string;
  command: string;
  args: string[];
}

/** One audit record. */
export interface PluginAuditEntry {
  /** ISO timestamp, written at append time. */
  at?: string;
  action: 'install' | 'uninstall';
  plugin: string;
  version?: string | null;
  /** Where the package came from (a path, or the URL/archive it was imported from). */
  packageRoot?: string | null;
  /** Resources materialized into the workspace. */
  skills?: string[];
  sources?: string[];
  /** Existing resources this action replaced, as `kind:slug`. */
  replaced?: string[];
  /** stdio servers the package will execute, with args, recorded in full. */
  stdioCommands?: PluginAuditStdioCommand[];
  /** Resources removed, for an uninstall. */
  removed?: string[];
  /** Resources kept because another plugin still references them (D10). */
  retained?: string[];
}

/**
 * Append one audit record.
 *
 * Never throws: a plugin action must not fail because its audit trail could not
 * be written, and the caller has already mutated the workspace by this point.
 *
 * The record shape deliberately contains no `env` values — only slugs, commands,
 * and args — so no credential redaction pass is needed here. A package's secrets
 * live in the credential store, never in the audit trail.
 */
export function appendPluginAuditEntry(entry: PluginAuditEntry): void {
  const record = { at: new Date().toISOString(), ...entry };
  const logPath = resolveAuditLogPath();

  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (error) {
    debug('[PluginAudit] Failed to append audit entry:', error);
  }
}

/**
 * Read the audit log, oldest first.
 *
 * @param limit - Optional cap on returned records (most recent kept).
 */
export function readPluginAuditLog(limit?: number): PluginAuditEntry[] {
  const logPath = resolveAuditLogPath();

  try {
    if (!existsSync(logPath)) return [];

    const entries = readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as PluginAuditEntry);

    return limit === undefined ? entries : entries.slice(-limit);
  } catch (error) {
    debug('[PluginAudit] Failed to read audit log:', error);
    return [];
  }
}

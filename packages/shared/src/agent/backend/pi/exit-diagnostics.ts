import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Crash reports contain bounded stderr and identities, never prompts or auth config. */
export function writePiExitDiagnostic(sessionPath: string, record: Record<string, unknown>, stderr: string, secrets: string[]): string {
  let safe = stderr;
  for (const secret of secrets.filter(value => value.length >= 8).sort((a, b) => b.length - a.length)) {
    safe = safe.replaceAll(secret, '[REDACTED]');
  }
  safe = safe.replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)["']?\s*[=:]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]');
  const directory = join(sessionPath, 'diagnostics');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `pi-exit-${Date.now()}-${record.pid ?? 'unknown'}.json`);
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, ...record, stderr: safe.slice(-8192) }, null, 2) + '\n', { mode: 0o600 });
  return path;
}

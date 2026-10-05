import { applyFilesystemIsolation } from './filesystem-isolation.ts';
import { applyNetworkIsolation } from './network-isolation.ts';
import { prepareScriptRuntime, type ScriptRuntimeLanguage } from './resolve-script-runtime.ts';
import { createScriptRuntimeEnv } from './sandbox-env.ts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPathWithinDirectoryForCreation } from './path-security.ts';

/** Own the script's package scope so workspace metadata cannot change its language. */
export function createIsolatedScriptFile(language: ScriptRuntimeLanguage, source: string, sessionDir: string, dataDir: string) {
  if (!isPathWithinDirectoryForCreation(dataDir, sessionDir)) throw new Error('Script data directory must remain inside the session directory.');
  mkdirSync(dataDir, { recursive: true });
  const directory = mkdtempSync(join(dataDir, '.script-'));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    // Node's syntax detection supports both require() and import statements
    // when the nearest package.json leaves the type unspecified.
    if (language === 'node') writeFileSync(join(directory, 'package.json'), '{}\n');
    const path = join(directory, language === 'python3' ? 'script.py' : 'script.js');
    writeFileSync(path, source, 'utf8');
    return { path, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** One preparation/environment/isolation path for both script tools. */
export async function prepareIsolatedScript(language: ScriptRuntimeLanguage, scriptArgs: string[], sessionDir: string, dataDir: string, readablePaths: string[] = []) {
  const probe = applyFilesystemIsolation(process.execPath, [], sessionDir);
  if (probe.status !== 'enforced') throw new Error('Script execution requires filesystem and network isolation in all permission modes; no supported backend is available on this platform.');
  const runtime = await prepareScriptRuntime(language);
  const args = [...runtime.argsPrefix, ...scriptArgs];
  const options = { writablePaths: [dataDir], readablePaths: [...(runtime.readablePaths ?? []), ...readablePaths] };
  const network = process.platform === 'darwin'
    ? { status: 'enforced' as const, backend: 'sandbox-exec', command: runtime.command, args }
    : applyNetworkIsolation(runtime.command, args);
  if (network.status !== 'enforced') throw new Error('Script execution requires network isolation in all permission modes; no supported backend is available on this platform.');
  const filesystem = applyFilesystemIsolation(network.command, network.args, sessionDir, { ...options, includeNetworkDeny: process.platform === 'darwin' });
  if (filesystem.status !== 'enforced') throw new Error('Script execution requires filesystem isolation; no usable backend is available.');
  const env = { ...createScriptRuntimeEnv({ language, dataDir }), ...runtime.envPatch };
  const diagnostics = [
    'isolationPolicy: required-in-all-modes', `runtime: ${runtime.command} (source: ${runtime.source})`,
    `networkIsolation: ${network.status}`, `networkBackend: ${network.backend}`,
    `filesystemIsolation: ${filesystem.status}`, `filesystemBackend: ${filesystem.backend}`,
  ];
  return { runtime, command: filesystem.command, args: filesystem.args, env, diagnostics };
}

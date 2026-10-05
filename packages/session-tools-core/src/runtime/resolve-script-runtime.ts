import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createSanitizedEnv } from './sandbox-env.ts';

export type ScriptRuntimeLanguage = 'python3' | 'node' | 'bun';

/**
 * Python patch the bundled uv prepares for script tools and CLI wrappers.
 *
 * Pinned to an exact patch, not to `3.12`. uv prefers an already-installed
 * managed interpreter over a newer download, so `--python 3.12` silently keeps
 * serving whatever patch the user first cached — a machine that installed
 * cpython-3.12.12 keeps running 3.12.12 forever. An exact request either reuses
 * the right patch or downloads it, so the interpreter cannot drift behind the
 * security baseline shipped in this release.
 *
 * Must stay in step with the `--python` flag in
 * apps/electron/resources/bin/*{,.cmd}; scripts/check-python-runtime-pin.ts
 * enforces that.
 */
export const TOOL_PYTHON_VERSION = '3.12.15';

export interface ResolvedScriptRuntime {
  command: string;
  argsPrefix: string[];
  source: 'env' | 'bundled' | 'path' | 'electron' | 'managed';
  /** Per-child environment changes; never applied to the host process. */
  envPatch?: NodeJS.ProcessEnv;
  /** Runtime assets mounted read-only by Linux isolation. */
  readablePaths?: string[];
}

export interface ResolveScriptRuntimeContext {
  /**
   * Whether host app is packaged. Defaults to PHANERIS_IS_PACKAGED=1.
   * In packaged mode, PATH fallback is blocked by default.
   */
  isPackaged?: boolean;

  /**
   * Optional explicit app root path (usually Electron app.getAppPath()).
   */
  appRootPath?: string;

  /**
   * Optional explicit resources base used by Electron startup.
   * Typically:
   * - packaged: <process.resourcesPath>/app
   * - dev: <repo>/apps/electron
   */
  resourcesBasePath?: string;
}

function resolveBinaryOnPath(binary: string): string | null {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [binary], { encoding: 'utf8' });

  if (result.status !== 0) {
    return null;
  }

  const matches = result.stdout
    ?.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean) ?? [];

  // `where bun` can list an extensionless npm shim before bun.exe on Windows.
  // child_process.spawn cannot execute that shim directly, so prefer a native
  // executable whenever the resolver reports one.
  const firstMatch = process.platform === 'win32'
    ? matches.find(match => /\.(?:exe|com)$/i.test(match)) ?? matches[0]
    : matches[0];

  return firstMatch ?? null;
}

function firstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolvedCandidate = resolve(candidate);
    if (existsSync(resolvedCandidate)) {
      return resolvedCandidate;
    }
  }
  return null;
}

function getPlatformRuntimeDir(): string {
  return `${process.platform}-${process.arch}`;
}

function inferPackagedMode(ctx?: ResolveScriptRuntimeContext): boolean {
  if (typeof ctx?.isPackaged === 'boolean') return ctx.isPackaged;
  const value = process.env.PHANERIS_IS_PACKAGED?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

function getProcessResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function resolveResourcesBase(ctx?: ResolveScriptRuntimeContext): string | null {
  const explicit = ctx?.resourcesBasePath || process.env.PHANERIS_RESOURCES_BASE;
  if (explicit) return resolve(explicit);

  const resourcesPath = getProcessResourcesPath();
  if (resourcesPath) {
    const packagedCandidate = join(resourcesPath, 'app');
    if (existsSync(packagedCandidate)) return packagedCandidate;
  }

  return null;
}

function resolveAppRoot(ctx?: ResolveScriptRuntimeContext): string | null {
  const explicit = ctx?.appRootPath || process.env.PHANERIS_APP_ROOT;
  return explicit ? resolve(explicit) : null;
}

function resolveBundledUv(ctx?: ResolveScriptRuntimeContext): string | null {
  const binary = process.platform === 'win32' ? 'uv.exe' : 'uv';
  const platformDir = getPlatformRuntimeDir();
  const resourcesBase = resolveResourcesBase(ctx);
  const appRoot = resolveAppRoot(ctx);

  const resourcesPath = getProcessResourcesPath();

  return firstExistingPath([
    resourcesBase ? join(resourcesBase, 'resources', 'bin', platformDir, binary) : '',
    appRoot ? join(appRoot, 'resources', 'bin', platformDir, binary) : '',
    resourcesPath ? join(resourcesPath, 'app', 'resources', 'bin', platformDir, binary) : '',
  ]);
}

function resolveBundledNode(ctx?: ResolveScriptRuntimeContext): string | null {
  const binary = process.platform === 'win32' ? 'node.exe' : 'node';
  const resourcesBase = resolveResourcesBase(ctx);
  const appRoot = resolveAppRoot(ctx);

  return firstExistingPath([
    resourcesBase ? join(resourcesBase, 'vendor', 'node', binary) : '',
    appRoot ? join(appRoot, 'vendor', 'node', binary) : '',
  ]);
}

function resolveBundledBun(ctx?: ResolveScriptRuntimeContext): string | null {
  const binary = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const resourcesBase = resolveResourcesBase(ctx);
  const appRoot = resolveAppRoot(ctx);

  return firstExistingPath([
    resourcesBase ? join(resourcesBase, 'vendor', 'bun', binary) : '',
    appRoot ? join(appRoot, 'vendor', 'bun', binary) : '',
  ]);
}

function validatePackagedEnvRuntime(command: string, label: string): string {
  const hasPathSeparator = command.includes('/') || command.includes('\\');

  if (!isAbsolute(command) && !hasPathSeparator) {
    throw new Error(
      `${label} runtime from env is not an absolute/bundled path (${command}). ` +
      'Packaged builds do not allow PATH-based runtime resolution. Configure an absolute PHANERIS_* path or ship a bundled runtime.'
    );
  }

  const resolvedCommand = resolve(command);
  if (!existsSync(resolvedCommand)) {
    throw new Error(
      `${label} runtime from env does not exist: ${resolvedCommand}. ` +
      'Configure a valid absolute PHANERIS_* path or ship a bundled runtime.'
    );
  }

  return resolvedCommand;
}

/**
 * Resolve runtime command and fixed argument prefix for script execution tools.
 *
 * Resolution order:
 * - env override (PHANERIS_UV / PHANERIS_NODE / PHANERIS_BUN)
 * - bundled binary path (when available)
 * - PATH fallback (dev only)
 */
export function resolveScriptRuntime(
  language: ScriptRuntimeLanguage,
  ctx?: ResolveScriptRuntimeContext,
): ResolvedScriptRuntime {
  const isPackaged = inferPackagedMode(ctx);

  if (language === 'python3') {
    if (process.env.PHANERIS_UV) {
      const cmd = isPackaged
        ? validatePackagedEnvRuntime(process.env.PHANERIS_UV, 'Python/uv')
        : process.env.PHANERIS_UV;

      return {
        command: cmd,
        argsPrefix: ['run', '--python', TOOL_PYTHON_VERSION],
        source: 'env',
      };
    }

    const bundledUv = resolveBundledUv(ctx);
    if (bundledUv) {
      return {
        command: bundledUv,
        argsPrefix: ['run', '--python', TOOL_PYTHON_VERSION],
        source: 'bundled',
      };
    }

    if (!isPackaged) {
      const uvPath = resolveBinaryOnPath('uv');
      if (uvPath) {
        return {
          command: uvPath,
          argsPrefix: ['run', '--python', TOOL_PYTHON_VERSION],
          source: 'path',
        };
      }
    }

    throw new Error(
      isPackaged
        ? 'Python runtime unavailable in packaged app: uv was not found in env or bundled resources.'
        : 'Python runtime unavailable: uv was not found. Configure PHANERIS_UV or install uv on PATH.'
    );
  }

  if (language === 'node') {
    if (process.env.PHANERIS_NODE) {
      const cmd = isPackaged
        ? validatePackagedEnvRuntime(process.env.PHANERIS_NODE, 'Node')
        : process.env.PHANERIS_NODE;
      return { command: cmd, argsPrefix: [], source: 'env' };
    }

    const bundledNode = resolveBundledNode(ctx);
    if (bundledNode) {
      return { command: bundledNode, argsPrefix: [], source: 'bundled' };
    }

    // Electron ships a real Node runtime. The host forwards this hint to its
    // server subprocess, where process.execPath may instead be Bun.
    const electron = process.env.PHANERIS_ELECTRON_EXECUTABLE
      || (process.versions.electron ? process.execPath : undefined);
    if (electron) {
      const command = validatePackagedEnvRuntime(electron, 'Electron/Node');
      const bundle = process.platform === 'darwin' ? resolve(command, '../../..') : dirname(command);
      return { command, argsPrefix: [], source: 'electron', envPatch: { ELECTRON_RUN_AS_NODE: '1' }, readablePaths: [bundle] };
    }

    if (!isPackaged) {
      const nodePath = resolveBinaryOnPath('node');
      if (nodePath) {
        return { command: nodePath, argsPrefix: [], source: 'path' };
      }
    }

    throw new Error(
      isPackaged
        ? 'Node runtime unavailable in packaged app: node was not found in env or bundled resources.'
        : 'Node runtime unavailable: configure PHANERIS_NODE or install node on PATH.'
    );
  }

  if (process.env.PHANERIS_BUN) {
    const cmd = isPackaged
      ? validatePackagedEnvRuntime(process.env.PHANERIS_BUN, 'Bun')
      : process.env.PHANERIS_BUN;
    return { command: cmd, argsPrefix: [], source: 'env' };
  }

  const bundledBun = resolveBundledBun(ctx);
  if (bundledBun) {
    return { command: bundledBun, argsPrefix: [], source: 'bundled' };
  }

  if (!isPackaged) {
    const bunPath = resolveBinaryOnPath('bun');
    if (bunPath) {
      return { command: bunPath, argsPrefix: [], source: 'path' };
    }
  }

  throw new Error(
    isPackaged
      ? 'Bun runtime unavailable in packaged app: bun was not found in env or bundled resources.'
      : 'Bun runtime unavailable: configure PHANERIS_BUN or install bun on PATH.'
  );
}

const pythonPreparations = new Map<string, Promise<ResolvedScriptRuntime>>();

/** Run only fixed runtime-management commands outside the script sandbox. */
async function runRuntimeSetup(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { env, cwd: env.UV_PYTHON_INSTALL_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { child.kill('SIGKILL'); }
      reject(new Error('Runtime preparation timed out. Retry with a working connection or a previously prepared Python runtime.'));
    }, 120_000);
    child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-16_000); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-16_000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolveResult({ code, stdout, stderr }); });
  });
}

/**
 * Prepare the pinned interpreter before isolation, then execute Python directly.
 * No user script, dependency metadata, or project configuration reaches uv.
 * The application-owned preparation is shared by concurrent calls.
 */
export async function prepareScriptRuntime(language: ScriptRuntimeLanguage, ctx?: ResolveScriptRuntimeContext): Promise<ResolvedScriptRuntime> {
  const runtime = resolveScriptRuntime(language, ctx);
  if (language !== 'python3') {
    const command = existsSync(runtime.command) ? realpathSync(runtime.command) : resolveBinaryOnPath(runtime.command);
    if (!command) throw new Error(`${language} runtime could not be located: ${runtime.command}`);
    return { ...runtime, command, readablePaths: runtime.readablePaths ?? [dirname(command)] };
  }
  const configRoot = process.env.PHANERIS_CONFIG_DIR || join(homedir(), '.phaneris');
  const runtimeRoot = resolve(process.env.PHANERIS_SCRIPT_RUNTIME_DIR || join(configRoot, 'runtimes'));
  const installDir = join(runtimeRoot, getPlatformRuntimeDir(), `python-${TOOL_PYTHON_VERSION}`);
  const pending = pythonPreparations.get(installDir);
  if (pending) return pending;
  const preparation = (async (): Promise<ResolvedScriptRuntime> => {
    const cacheDir = join(runtimeRoot, 'uv-cache'), tempDir = join(runtimeRoot, 'tmp');
    for (const path of [installDir, cacheDir, tempDir]) mkdirSync(path, { recursive: true });
    const env = createSanitizedEnv();
    Object.assign(env, { UV_PYTHON_INSTALL_DIR: installDir, UV_CACHE_DIR: cacheDir, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir });
    const findArgs = ['python', 'find', '--managed-python', '--no-python-downloads', '--no-project', '--no-config', '--offline', TOOL_PYTHON_VERSION];
    let found = await runRuntimeSetup(runtime.command, findArgs, env);
    if (found.code !== 0) {
      const installed = await runRuntimeSetup(runtime.command, ['python', 'install', '--install-dir', installDir, '--no-bin', '--no-registry', '--no-config', TOOL_PYTHON_VERSION], env);
      if (installed.code !== 0) throw new Error(installed.stderr.trim() || 'Could not prepare the pinned Python interpreter.');
      found = await runRuntimeSetup(runtime.command, findArgs, env);
    }
    if (found.code !== 0) throw new Error(found.stderr.trim() || 'Prepared Python interpreter could not be located.');
    const command = realpathSync(found.stdout.trim());
    const boundary = relative(realpathSync(installDir), command);
    if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('uv returned an interpreter outside the application runtime directory.');
    const version = await runRuntimeSetup(command, ['-I', '--version'], env);
    if (version.code !== 0 || version.stdout.trim() !== `Python ${TOOL_PYTHON_VERSION}`) throw new Error('Prepared Python does not match the pinned runtime version.');
    return { command, argsPrefix: ['-I', '-B'], source: 'managed', readablePaths: [dirname(dirname(command))] };
  })();
  pythonPreparations.set(installDir, preparation);
  try { return await preparation; }
  catch (error) { throw new Error(`Python runtime not ready (${TOOL_PYTHON_VERSION}): ${error instanceof Error ? error.message : String(error)} Scripts have not run; sandbox restrictions remain enforced.`); }
  finally { pythonPreparations.delete(installDir); }
}

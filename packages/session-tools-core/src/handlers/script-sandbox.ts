import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';
import { isPathWithinDirectory } from '../runtime/path-security.ts';
import { createIsolatedScriptFile, prepareIsolatedScript } from '../runtime/isolated-script.ts';

export interface ScriptSandboxArgs {
  language: 'python3' | 'node' | 'bun';
  script: string;
  inputFiles?: string[];
  stdin?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 20_000;

function truncateOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, MAX_OUTPUT_CHARS),
    truncated: true,
  };
}

export async function handleScriptSandbox(
  ctx: SessionToolContext,
  args: ScriptSandboxArgs
): Promise<ToolResult> {
  if (!ctx.sessionPath || !ctx.dataPath) {
    return errorResponse('script_sandbox requires sessionPath and dataPath in context.');
  }

  const sessionDir = ctx.sessionPath;
  const dataDir = ctx.dataPath;

  const inputFiles = args.inputFiles ?? [];
  const resolvedInputs: string[] = [];
  for (const inputFile of inputFiles) {
    const resolvedInput = resolve(sessionDir, inputFile);
    if (!isPathWithinDirectory(resolvedInput, sessionDir)) {
      return errorResponse(`inputFile must be within the session directory. Got: ${inputFile}`);
    }
    if (!existsSync(resolvedInput)) {
      return errorResponse(`input file not found: ${inputFile}`);
    }
    resolvedInputs.push(resolvedInput);
  }

  const timeoutMs = Math.min(Math.max(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
  let scriptFile: ReturnType<typeof createIsolatedScriptFile> | undefined;

  try {
    scriptFile = createIsolatedScriptFile(args.language, args.script, sessionDir, dataDir);
    const execution = await prepareIsolatedScript(args.language, [scriptFile.path, ...resolvedInputs], sessionDir, dataDir);
    const startedAt = Date.now();
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((resolvePromise, reject) => {
      const child = spawn(execution.command, execution.args, {
        cwd: dataDir,
        env: execution.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Make the child a process-group leader so the timeout can SIGKILL the
        // whole group (N-5: previously only the direct child was killed,
        // orphaning grandchildren spawned by the script).
        detached: true,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const settle = (value: { stdout: string; stderr: string; code: number | null; timedOut: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolvePromise(value);
      };

      // Settle on the timer itself so a `close` that never fires can't hang the
      // caller; the group kill below then reaps the whole process tree.
      const killTimer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid !== undefined) {
            process.kill(-child.pid, 'SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // Negative-PID kill unsupported on this platform — fall back to the child only.
          child.kill('SIGKILL');
        }
        settle({ stdout, stderr, code: null, timedOut: true });
      }, timeoutMs);

      if (typeof args.stdin === 'string') {
        child.stdin.write(args.stdin);
      }
      child.stdin.end();

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        settle({ stdout, stderr, code, timedOut });
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        reject(err);
      });
    });

    const durationMs = Date.now() - startedAt;
    const stdout = truncateOutput(result.stdout);
    const stderr = truncateOutput(result.stderr);

    const lines: string[] = [
      `exitCode: ${result.code ?? 'null'}`,
      `durationMs: ${durationMs}`,
      `timedOut: ${result.timedOut}`,
      ...execution.diagnostics,
    ];

    if (stdout.text.length > 0) {
      lines.push('', 'stdout:', stdout.text);
      if (stdout.truncated) {
        lines.push(`\n[stdout truncated to ${MAX_OUTPUT_CHARS} characters]`);
      }
    }

    if (stderr.text.length > 0) {
      lines.push('', 'stderr:', stderr.text);
      if (stderr.truncated) {
        lines.push(`\n[stderr truncated to ${MAX_OUTPUT_CHARS} characters]`);
      }
    }

    if (result.code !== 0) {
      return errorResponse(lines.join('\n'));
    }

    return successResponse(lines.join('\n'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Error running sandboxed script: ${msg}`);
  } finally {
    try {
      scriptFile?.cleanup();
    } catch {
      // ignore cleanup errors
    }
  }
}

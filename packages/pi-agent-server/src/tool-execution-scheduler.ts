import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { isReadOnlyMcpToolName } from '@phaneris/shared/agent/mcp-tool-names';
import { browserEffectRequiresApproval, getBrowserToolEffect, isSessionBrowserTool } from '@phaneris/shared/agent/browser-tool-effects';

const READ_VERBS = ['get', 'list', 'read', 'search', 'fetch', 'find', 'query', 'count', 'exists', 'status', 'info'];

export interface ToolResource {
  domain: string;
  access: 'read' | 'write';
  path?: string;
}

/** Resolve existing ancestors so relative paths and directory junctions share a lock. */
function physicalPath(path: string, cwd: string): string {
  const expanded = path === '~' || /^~[/\\]/.test(path) ? `${homedir()}${path.slice(1)}` : path;
  let ancestor = resolve(cwd, expanded);
  const missing: string[] = [];
  for (;;) {
    try {
      const actual = resolve(realpathSync(ancestor), ...missing);
      return process.platform === 'win32' ? actual.toLowerCase() : actual;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

/** Scheduling metadata never grants permission. Unknown effects get a session barrier. */
export function toolExecutionResources(name: string, args: Record<string, unknown>, cwd: string, trustedReadOnly = false): ToolResource[] {
  if (name === 'codemode' || name === 'tool_search' || name === 'mcp__session__ask_user') return []; // Presentation/orchestration; nested calls acquire their own resources.
  if (['read', 'Read', 'write', 'Write', 'edit', 'Edit', 'MultiEdit', 'NotebookEdit', 'find', 'Find', 'ls', 'Ls', 'grep', 'Grep'].includes(name)) {
    const raw = args.path ?? args.file_path ?? args.notebook_path ?? cwd;
    if (typeof raw !== 'string') return [{ domain: '*', access: 'write' }];
    return [{ domain: 'files', path: physicalPath(raw, cwd), access: ['write', 'Write', 'edit', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) ? 'write' : 'read' }];
  }
  if (/^(?:mcp__session__|session__)?(?:SubmitPlan|source_(?:google_|slack_|microsoft_)?oauth_trigger|source_credential_prompt)$/.test(name)) return [{ domain: '*', access: 'write' }];
  if (['web_search', 'web_fetch', 'WebSearch', 'WebFetch', 'mcp__session__web_search', 'mcp__session__web_fetch'].includes(name)) return [{ domain: 'web', access: 'read' }];
  if (/^(?:mcp__session__)?(?:script_sandbox|transform_data|render_template)$/.test(name)) return [{ domain: '*', access: 'write' }];
  if (isSessionBrowserTool(name)) return [{ domain: browserEffectRequiresApproval(getBrowserToolEffect(name, args)) ? '*' : 'browser', access: 'write' }];
  if (name.startsWith('mcp__session__')) {
    // Only host-owned canonical session definitions can assert readOnly.
    if (trustedReadOnly) return [{ domain: 'session', access: 'read' }];
    // Session mutations can also touch files, sources and automations.
    return [{ domain: '*', access: 'write' }];
  }
  if (name.startsWith('mcp__') || name.startsWith('api_')) {
    // Concurrency only: host permission checks still run for every call. Use
    // the host's pure verb classifier, never author-supplied annotations.
    const api = name.startsWith('api_') || name.includes('__api_');
    const read = api ? ['GET', 'HEAD'].includes(typeof args.method === 'string' ? args.method.toUpperCase() : 'GET')
      : isReadOnlyMcpToolName(name, READ_VERBS);
    return read ? [{ domain: `source:${name.startsWith('mcp__') ? name.split('__')[1] : name}`, access: 'read' }]
      : [{ domain: '*', access: 'write' }];
  }
  return [{ domain: '*', access: 'write' }];
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function conflict(a: readonly ToolResource[], b: readonly ToolResource[]): boolean {
  return a.some(left => b.some(right => {
    if (left.access === 'read' && right.access === 'read') return false;
    if (left.domain === '*' || right.domain === '*') return true;
    if (left.domain !== right.domain) return false;
    return !left.path || !right.path || contains(left.path, right.path) || contains(right.path, left.path);
  }));
}

interface Waiting {
  resources: readonly ToolResource[];
  signal?: AbortSignal;
  start(): void;
  cancel(): void;
}

/** In-process ordering through T2. Durable recovery owns unknown/cross-process effects. */
export class ToolExecutionScheduler {
  private readonly running = new Set<Waiting>();
  private readonly waiting: Waiting[] = [];

  run<T>(resources: readonly ToolResource[], signal: AbortSignal | undefined, execute: () => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!resources.length) return execute();
    return new Promise<T>((resolveResult, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(job);
        if (index < 0) return; // Running effects settle in execute/finally, not on cancellation.
        this.waiting.splice(index, 1);
        signal?.removeEventListener('abort', abort);
        reject(signal?.reason ?? new Error('Tool execution cancelled'));
        this.drain();
      };
      const job: Waiting = {
        resources, signal, cancel: abort,
        start: () => {
          signal?.removeEventListener('abort', abort);
          this.running.add(job);
          void Promise.resolve().then(() => {
            signal?.throwIfAborted();
            return execute();
          }).then(resolveResult, reject).finally(() => {
            this.running.delete(job);
            this.drain();
          });
        },
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(job);
      this.drain();
    });
  }

  private drain(): void {
    for (let index = 0; index < this.waiting.length;) {
      const job = this.waiting[index]!;
      if (job.signal?.aborted) { job.cancel(); continue; }
      const blocked = [...this.running].some(active => conflict(active.resources, job.resources))
        || this.waiting.slice(0, index).some(earlier => conflict(earlier.resources, job.resources));
      if (blocked) { index++; continue; }
      this.waiting.splice(index, 1);
      job.start();
    }
  }
}

/**
 * Git developer context for the system prompt.
 *
 * The agent starts each session better oriented when it knows which repository
 * it is in, what the worktree currently looks like, and on which branch. The
 * context is split in two on purpose:
 *
 *  - {@link formatStableGitDeveloperContext} — repository identity plus standing
 *    git guidance. Invariant while the working directory stays put, so it belongs
 *    in the cached system prefix.
 *  - {@link formatVolatileGitDeveloperContext} — branch, ahead/behind, worktree
 *    state and a bounded sample of changed files. Changes between turns, so it
 *    rides the volatile user-message tail (issue #862).
 *
 * Every git call is bounded (`GIT_TIMEOUT_MS`, 128 KiB) and fails soft: outside a
 * repository, or with git missing/hanging, the block is simply absent rather than
 * blocking the turn. Repository remotes are redacted before they reach the prompt.
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { redactPromptUrlCredentials, sanitizePromptLine } from './prompt-sanitize.ts';

const DEVELOPER_CONTEXT_TAGS = ['developer_context'] as const;
const MAX_CHANGED_FILE_SAMPLE = 20;
const GIT_TIMEOUT_MS = 700;

export interface GitDeveloperContextIdentity {
  repoRoot: string;
  repoParent: string;
  selectedWorkingDirectory: string;
  selectedPathWithinRepo: string;
  originUrl?: string;
  defaultBranch?: string;
}

export interface GitDeveloperContextStatus {
  branch?: string;
  detachedHead?: string;
  upstream?: string;
  worktreeState: 'clean' | 'dirty' | 'unknown';
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  ahead?: number;
  behind?: number;
  changedFilesSample: string[];
}

/** Return the nearest git worktree root for a directory, or null outside git. */
export function findGitRepositoryRoot(workingDirectory?: string): string | null {
  if (!workingDirectory) return null;

  let current: string;
  try {
    const resolved = resolve(workingDirectory);
    const stat = statSync(resolved);
    current = stat.isDirectory() ? resolved : dirname(resolved);
  } catch {
    return null;
  }

  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Repository identity and standing guidance — stable within a worktree. */
export function formatStableGitDeveloperContext(workingDirectory?: string): string | null {
  const ctx = collectGitDeveloperIdentity(workingDirectory, true);
  if (!ctx) return null;

  const lines = [
    `<developer_context kind="git_repository" scope="stable">`,
    `repoRoot: ${line(ctx.repoRoot)}`,
    `repoParent: ${line(ctx.repoParent)}`,
    `selectedWorkingDirectory: ${line(ctx.selectedWorkingDirectory)}`,
    `selectedPathWithinRepo: ${line(ctx.selectedPathWithinRepo)}`,
  ];
  if (ctx.originUrl) lines.push(`origin: ${line(ctx.originUrl)}`);
  if (ctx.defaultBranch) lines.push(`defaultBranch: ${line(ctx.defaultBranch)}`);

  lines.push('', 'Guidance:');
  lines.push('- Treat uncommitted changes as user work; inspect before overwriting.');
  lines.push('- Prefer minimal, reviewable diffs.');
  lines.push('- Read the root AGENTS.md/CLAUDE.md first, then path-specific context files when relevant.');
  lines.push('- Update the nearest AGENTS.md/CLAUDE.md when behavior or conventions change.');
  lines.push('- Do not switch branches, reset, rebase, force-push, or delete work unless explicitly requested.');
  lines.push('- When creating a git worktree, create it as a sibling of repoRoot inside repoParent unless the user explicitly asks for another location.');
  lines.push('- Before committing, check status and include the configured co-author trailer when required.');
  lines.push('</developer_context>');

  return lines.join('\n');
}

/** Branch/status snapshot for the current turn — volatile by nature. */
export function formatVolatileGitDeveloperContext(workingDirectory?: string): string | null {
  const identity = collectGitDeveloperIdentity(workingDirectory, false);
  if (!identity) return null;
  const ctx = collectGitDeveloperStatus(identity.repoRoot);

  const lines = [
    `<developer_context kind="git_repository" scope="volatile">`,
  ];
  if (ctx.branch) {
    lines.push(`branch: ${line(ctx.branch)}`);
  } else if (ctx.detachedHead) {
    lines.push(`branch: detached@${line(ctx.detachedHead)}`);
  }
  if (ctx.upstream) lines.push(`upstream: ${line(ctx.upstream)}`);
  if (typeof ctx.ahead === 'number') lines.push(`ahead: ${ctx.ahead}`);
  if (typeof ctx.behind === 'number') lines.push(`behind: ${ctx.behind}`);
  lines.push(`worktreeState: ${ctx.worktreeState}`);
  lines.push(`stagedFiles: ${ctx.stagedFiles}`);
  lines.push(`unstagedFiles: ${ctx.unstagedFiles}`);
  lines.push(`untrackedFiles: ${ctx.untrackedFiles}`);

  if (ctx.changedFilesSample.length > 0) {
    lines.push('changedFilesSample:');
    for (const file of ctx.changedFilesSample.slice(0, MAX_CHANGED_FILE_SAMPLE)) {
      lines.push(`- ${line(file)}`);
    }
  }

  lines.push('</developer_context>');
  return lines.join('\n');
}

function collectGitDeveloperIdentity(
  workingDirectory: string | undefined,
  includeRemoteDetails: boolean,
): GitDeveloperContextIdentity | null {
  const discoveredRoot = findGitRepositoryRoot(workingDirectory);
  if (!discoveredRoot || !workingDirectory) return null;

  const selectedWorkingDirectory = realPathOrResolve(workingDirectory);
  const gitRoot = runGit(selectedWorkingDirectory, ['rev-parse', '--show-toplevel']) ?? discoveredRoot;
  const repoRoot = realPathOrResolve(gitRoot);
  const repoParent = dirname(repoRoot);
  const selectedPathWithinRepo = normalizeRelativePath(relative(repoRoot, selectedWorkingDirectory)) || '.';

  if (!includeRemoteDetails) {
    return {
      repoRoot,
      repoParent,
      selectedWorkingDirectory,
      selectedPathWithinRepo,
    };
  }

  const originRaw = runGit(repoRoot, ['remote', 'get-url', 'origin']);
  const originUrl = originRaw ? redactPromptUrlCredentials(originRaw) : undefined;
  // `symbolic-ref origin/HEAD` reports e.g. `origin/main`; the branch name is what matters.
  const defaultBranch = runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    ?.replace(/^origin\//, '') || undefined;

  return {
    repoRoot,
    repoParent,
    selectedWorkingDirectory,
    selectedPathWithinRepo,
    originUrl,
    defaultBranch,
  };
}

function collectGitDeveloperStatus(repoRoot: string): GitDeveloperContextStatus {
  const branch = runGit(repoRoot, ['branch', '--show-current']) || undefined;
  const detachedHead = branch ? undefined : runGit(repoRoot, ['rev-parse', '--short', 'HEAD']) || undefined;
  const upstream = runGit(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || undefined;
  const status = parseStatus(runGit(repoRoot, ['status', '--porcelain=v1', '--branch', '--untracked-files=all']));

  return {
    branch,
    detachedHead,
    upstream,
    ...status,
  };
}

/**
 * Run one bounded git command. A missing git binary, a non-zero exit (not a
 * repository, no upstream configured) or a timeout all collapse to `null`, which
 * the callers treat as "no evidence" rather than an error worth surfacing.
 */
function runGit(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) return null;
  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

function parseStatus(statusOutput: string | null): Pick<GitDeveloperContextStatus,
  'worktreeState' | 'stagedFiles' | 'unstagedFiles' | 'untrackedFiles' | 'ahead' | 'behind' | 'changedFilesSample'
> {
  if (statusOutput === null) {
    return {
      worktreeState: 'unknown',
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      changedFilesSample: [],
    };
  }

  let stagedFiles = 0;
  let unstagedFiles = 0;
  let untrackedFiles = 0;
  let ahead: number | undefined;
  let behind: number | undefined;
  const changedFilesSample: string[] = [];

  for (const rawLine of statusOutput.split('\n')) {
    if (!rawLine) continue;
    if (rawLine.startsWith('## ')) {
      const aheadMatch = rawLine.match(/ahead (\d+)/);
      const behindMatch = rawLine.match(/behind (\d+)/);
      ahead = aheadMatch ? Number(aheadMatch[1]) : undefined;
      behind = behindMatch ? Number(behindMatch[1]) : undefined;
      continue;
    }

    const indexStatus = rawLine[0] ?? ' ';
    const worktreeStatus = rawLine[1] ?? ' ';
    const file = rawLine.slice(3).trim();

    if (rawLine.startsWith('??')) {
      untrackedFiles += 1;
    } else {
      if (indexStatus !== ' ') stagedFiles += 1;
      if (worktreeStatus !== ' ') unstagedFiles += 1;
    }

    if (file && changedFilesSample.length < MAX_CHANGED_FILE_SAMPLE) {
      changedFilesSample.push(file);
    }
  }

  return {
    worktreeState: stagedFiles + unstagedFiles + untrackedFiles > 0 ? 'dirty' : 'clean',
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    ahead,
    behind,
    changedFilesSample,
  };
}

function realPathOrResolve(value: string): string {
  try {
    return realpathSync.native(resolve(value));
  } catch {
    return resolve(value);
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** One context line: credentials redacted, control chars out, closing tag defanged. */
function line(value: string): string {
  return sanitizePromptLine(redactPromptUrlCredentials(value), DEVELOPER_CONTEXT_TAGS);
}

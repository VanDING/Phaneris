/**
 * "Always Allow" keys for Ask mode.
 *
 * When the user answers a permission prompt with Always Allow, the agent
 * remembers a key and later auto-allows calls with the same key. The key is
 * computed by the code that checks the whitelist (`shouldPromptInAskMode`) and
 * travels with the prompt, so the agent never re-derives it and approving one
 * call can never approve a broader one.
 *
 * Bash keys exist only for a single plain command (no chains, pipes, redirects,
 * environment assignments or expansions): approving `git commit` must not
 * approve `git commit -m x && rm -rf ~`. Their granularity follows where the
 * command's effect is decided:
 * - CLIs with subcommands are keyed by the leading words before the first flag
 *   (up to three): `git commit`, `npm install lodash`, `aws s3 ls` (≠ `aws s3 rb`),
 *   `gh pr merge 12`;
 * - single-purpose commands are keyed by name: `mkdir`, `touch`, `open`;
 * - everything else is keyed by its exact argv, because flags or arguments
 *   decide what it does (`tar -tf` vs `tar -xf`, `psql -c "<any SQL>"`). That
 *   includes interpreters and runners, which execute whatever follows them
 *   (`python script.py --delete-all`, `docker run img rm -rf /`, `npx pkg`).
 * No key at all for dangerous commands, wrappers that run another command
 * (`sudo`, `env`, `xargs`, ...), a flag before the subcommand of a keyed CLI
 * (`git -C dir push`) or `gh api` (its method is a flag).
 *
 * File writes are keyed by folder, curl/wget by every host the call contacts.
 */

import { dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { expandPath } from '../../utils/paths.ts';
import { parseSimpleCommand } from '../bash-validator.ts';

/** What an "Always Allow" answer remembers. */
export type PermissionRemember =
  | { kind: 'command'; key: string }
  | { kind: 'domains'; domains: string[] };

/**
 * Commands that always require permission in Ask mode and are never remembered.
 * Two-word entries match `<command> <subcommand>`: destructive, publishing or
 * infrastructure-changing operations whose target is not in their leading words.
 */
export const DANGEROUS_COMMANDS: ReadonlySet<string> = new Set([
  'rm', 'rmdir', 'sudo', 'su', 'chmod', 'chown', 'chgrp',
  'mv', 'cp', 'dd', 'mkfs', 'fdisk', 'parted',
  'kill', 'killall', 'pkill',
  'reboot', 'shutdown', 'halt', 'poweroff',
  'curl', 'wget', 'ssh', 'scp', 'rsync',
  'git push', 'git reset', 'git rebase', 'git checkout', 'git clean', 'git restore', 'git switch',
  'git stash', 'git branch', 'git tag', 'git rm', 'git worktree', 'git gc', 'git reflog',
  'kubectl apply', 'kubectl delete', 'kubectl drain', 'kubectl replace',
  'helm install', 'helm upgrade', 'helm uninstall', 'helm rollback',
  'terraform apply', 'terraform destroy', 'tofu apply', 'tofu destroy', 'pulumi up', 'pulumi destroy',
  'npm publish', 'npm unpublish', 'pnpm publish', 'yarn publish', 'bun publish', 'cargo publish',
  'gem push', 'docker push', 'podman push',
  'netlify deploy', 'fly deploy', 'flyctl deploy', 'wrangler deploy', 'wrangler publish', 'firebase deploy',
]);

/** Commands that run another command given in their arguments: remembering them would approve anything. */
const COMMAND_WRAPPERS = new Set([
  'sudo', 'su', 'doas', 'pkexec', 'gosu', 'runuser', 'run0', 'sg', 'newgrp', 'setpriv', 'chpst',
  'env', 'xargs', 'nohup', 'time', 'timeout', 'watch', 'exec', 'eval', 'command', 'builtin',
  'nice', 'ionice', 'stdbuf', 'script', 'parallel', 'chroot', 'flock', 'caffeinate', 'arch',
  'unbuffer', 'strace', 'ltrace', 'dtruss', 'sandbox-exec', 'firejail', 'bwrap', 'nsenter', 'unshare',
]);

/** CLIs whose effect is decided by their leading words (subcommand, resource + action, script). */
const KEYED_BY_LEADING_WORDS = new Set([
  // Version control and forges
  'git', 'gh', 'glab', 'hg', 'svn',
  // Package managers and runners
  'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'deno', 'pip', 'pip3', 'pipx', 'uv', 'uvx',
  'poetry', 'conda', 'gem', 'bundle', 'cargo', 'go', 'composer', 'brew', 'port', 'apt', 'apt-get',
  'dnf', 'yum', 'pacman', 'mise', 'asdf', 'nix',
  // Build tools
  'make', 'just', 'rake', 'gradle', 'gradlew', 'mvn', 'dotnet', 'swift', 'xcodebuild', 'flutter',
  'dart', 'cmake', 'ninja', 'bazel',
  // Containers, infrastructure and cloud CLIs
  'docker', 'podman', 'kubectl', 'helm', 'terraform', 'tofu', 'pulumi', 'aws', 'gcloud', 'az',
  'doctl', 'fly', 'flyctl', 'vercel', 'netlify', 'wrangler', 'heroku', 'supabase', 'firebase',
  // Services
  'systemctl', 'launchctl', 'service',
]);

/** Leading words kept after the command name: enough for `gcloud compute instances delete`. */
const MAX_LEADING_WORDS = 3;

/**
 * A destructive verb among a keyed CLI's leading words means the target may come
 * after a flag (`aws s3 rm --recursive s3://prod`), outside the key: never remembered.
 * Matches whole words and dashed/colon forms (`terminate-instances`, `apps:destroy`).
 */
const DESTRUCTIVE_WORD = /(?:^|[-:_])(?:rm|rb|rmi|del|delete|remove|destroy|terminate|purge|drop|prune|kill|wipe|reset|revoke|uninstall|unpublish|deregister)(?:$|[-:_])/i;

/** Single-purpose commands: the name alone says what they do. */
const KEYED_BY_NAME = new Set([
  'mkdir', 'touch', 'open', 'xdg-open', 'code', 'cursor', 'subl', 'zed', 'pbcopy', 'say', 'afplay',
  'notify-send', 'sleep',
]);

/** Subcommand pairs that must never be remembered although their command is keyed. */
const NEVER_REMEMBERED_SUBCOMMANDS = new Set(['gh api']);

/** Commands and subcommands that execute whatever follows them: keyed by the exact argv. */
const RUNNER_COMMANDS = new Set(['npx', 'pnpx', 'bunx', 'uvx']);
const RUNNER_SUBCOMMANDS = new Set(['run', 'exec', 'x', 'dlx', 'run-script']);

function exactKey(argv: readonly string[]): string {
  return `exact:${JSON.stringify(argv)}`;
}

/** Only known options can participate in a remembered network call. */
const CURL_VALUE_OPTIONS = new Set([
  '--header', '--request', '--user-agent', '--user', '--referer',
  '--data', '--data-ascii', '--data-raw', '--data-binary', '--data-urlencode', '--json',
  '--max-time', '--connect-timeout', '--retry', '--retry-delay', '--retry-max-time', '--url',
]);
const CURL_NO_VALUE_OPTIONS = new Set([
  '--silent', '--show-error', '--fail', '--fail-with-body', '--head', '--show-headers',
  '--verbose', '--insecure', '--globoff', '--no-buffer', '--disable', '--compressed',
  '--ipv4', '--ipv6', '--http1.0', '--http1.1', '--http2', '--http2-prior-knowledge', '--get',
]);
const WGET_NO_VALUE_OPTIONS = new Set(['--quiet', '--verbose', '--no-verbose', '--spider']);

/**
 * `scheme://[userinfo@]host[:port][/path?query#fragment]`. User info may not contain
 * `/ \ ? #`, so `https://evil.com#@allowed.com` yields evil.com, as curl sees it.
 */
const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/\\\s@?#]+@)?(\[[0-9a-f:.]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::\d+)?(?:[/?#]\S*)?$/i;

function commandName(argv: readonly string[]): string {
  return (argv[0] ?? '').split('/').pop()!.toLowerCase();
}

/** Whether `argv` runs a dangerous command (`rm`, `sudo`, `git push`, ...). */
export function isDangerousArgv(argv: readonly string[]): boolean {
  const name = commandName(argv);
  if (DANGEROUS_COMMANDS.has(name)) return true;
  const sub = argv[1]?.toLowerCase();
  return sub !== undefined && DANGEROUS_COMMANDS.has(`${name} ${sub}`);
}

/**
 * The key an "Always Allow" answer may store for `command`, or `null` when the
 * command must be asked about every time.
 */
export function getBashRememberKey(command: string): string | null {
  const argv = parseSimpleCommand(command);
  if (!argv || argv.length === 0) return null;
  const name = commandName(argv);
  if (COMMAND_WRAPPERS.has(name) || isDangerousArgv(argv)) return null;

  if (KEYED_BY_LEADING_WORDS.has(name)) {
    const leading: string[] = [];
    for (const word of argv.slice(1, 1 + MAX_LEADING_WORDS)) {
      if (word.startsWith('-')) break;
      leading.push(word);
    }
    if (argv.length > 1 && leading.length === 0) return null; // a flag before the subcommand
    if (argv[1] && NEVER_REMEMBERED_SUBCOMMANDS.has(`${name} ${argv[1].toLowerCase()}`)) return null;
    if (leading.some(word => DESTRUCTIVE_WORD.test(word))) return null;
    if (RUNNER_COMMANDS.has(name) || leading.some(word => RUNNER_SUBCOMMANDS.has(word.toLowerCase()))) return exactKey(argv);
    // A word with whitespace could make two different argvs share one key.
    const words = [argv[0]!, ...leading];
    return words.some(word => /\s/.test(word)) ? null : words.join(' ');
  }

  if (KEYED_BY_NAME.has(name)) return argv[0]!;
  return exactKey(argv);
}

/** The key for a file write: the folder it writes into. */
export function getFileWriteRememberKey(filePath: string, workingDirectory?: string): string {
  const target = resolve(workingDirectory ?? process.cwd(), expandPath(filePath));
  let folder: string;
  try {
    // Existing symlinks are scoped by where the write actually goes.
    folder = dirname(realpathSync(target));
  } catch {
    folder = dirname(target);
    try { folder = realpathSync(folder); } catch { /* a new directory: lexical scope */ }
  }
  return `write:${folder}`;
}

/**
 * The hosts a single plain curl/wget call talks to, or `null` when that cannot
 * be vouched for: any other command (a chain could reach any host), extra
 * targets read from a config/input file, redirects, output files, unknown options,
 * or URLs without an explicit HTTP(S) scheme. Option values are consumed as values,
 * never stored as hosts (`-X PATCH` must not approve the host `patch`).
 */
export function getNetworkCommandHosts(command: string): string[] | null {
  const argv = parseSimpleCommand(command);
  if (!argv) return null;
  const name = commandName(argv);
  if (name !== 'curl' && name !== 'wget') return null;

  const hosts = new Set<string>();
  const addUrl = (url: string): boolean => {
    if (!/^https?:\/\//i.test(url)) return false;
    const host = URL_WITH_SCHEME.exec(url)?.[1];
    if (!host) return false;
    hosts.add(host.toLowerCase());
    return true;
  };
  let operandsOnly = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!operandsOnly && arg === '--') { operandsOnly = true; continue; }
    if (!operandsOnly && arg.startsWith('--')) {
      const [option] = arg.split('=', 1);
      const equals = arg.indexOf('=');
      const noValueOptions = name === 'curl' ? CURL_NO_VALUE_OPTIONS : WGET_NO_VALUE_OPTIONS;
      if (noValueOptions.has(option!) && equals === -1) continue;
      if (name !== 'curl' || !CURL_VALUE_OPTIONS.has(option!)) return null;
      const value = equals === -1 ? argv[++i] : arg.slice(equals + 1);
      if (value === undefined || (option === '--url' && !addUrl(value))) return null;
      continue;
    }
    if (!operandsOnly && arg.startsWith('-')) {
      const noValueFlags = name === 'curl' ? 'sSfIivkgNq046G' : 'qv';
      const valueFlags = name === 'curl' ? 'HdAXuem' : '';
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j]!;
        if (noValueFlags.includes(flag)) continue;
        if (!valueFlags.includes(flag)) return null;
        const value = arg.slice(j + 1) || argv[++i];
        if (value === undefined) return null;
        break;
      }
      continue;
    }
    if (!addUrl(arg)) return null;
  }
  return [...hosts];
}

/**
 * PrerequisiteManager - Prerequisite Reading System
 *
 * Blocks tool calls until specified files have been read in the current context window.
 * State resets on compaction since the LLM loses the guide content.
 *
 * Key responsibilities:
 * - Track which files have been read via the Read tool
 * - Check prerequisites before tool execution (e.g., guide.md for sources)
 * - Reset state on context compaction
 */

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, resolve, join } from 'node:path';
import bashParser from 'bash-parser';
import { DOCS_DIR } from '../../config/paths.ts';
import { expandPath } from './path-processor.ts';
import { getBrowserToolEnabled } from '../../config/appearance.ts';
import { isBrowserToolNameOrAlias } from '../browser-tool-names.ts';
import { isDerivedRead, type ToolResultProvenance } from '../tool-result-contract.ts';

// ============================================================
// Types
// ============================================================

export interface PrerequisiteRule {
  /** Match tool names that require prerequisites */
  toolMatcher: (toolName: string) => boolean;
  /** Resolve the required file path for a matched tool. Returns null to skip. */
  resolveRequiredPath: (toolName: string, workspaceRootPath: string) => string | null;
  /** Block message template. {filePath} is replaced with the required path. */
  blockMessage: string;
  /** If true, always block until file is read (no graceful fallback). */
  strict?: boolean;
}

export interface PrerequisiteCheckResult {
  allowed: boolean;
  blockReason?: string;
}

export interface PrerequisiteManagerConfig {
  workspaceRootPath: string;
  onDebug?: (message: string) => void;
}

// ============================================================
// Constants
// ============================================================

/** Slugs that are exempt from prerequisite checks (internal sources) */
const EXEMPT_SLUGS = new Set(['session']);

/** Global browser tools docs path required before browser tool usage. */
const BROWSER_TOOLS_DOC_PATH = resolve(join(DOCS_DIR, 'browser-tools.md'));

// ============================================================
// Rules
// ============================================================

/**
 * Static prerequisite rules. Each rule defines:
 * - Which tools it applies to
 * - What file must be read first
 * - What message to show when blocking
 */
const RULES: PrerequisiteRule[] = [
  // MCP source tools: mcp__{slug}__* format
  {
    toolMatcher: (toolName: string) => {
      if (!toolName.startsWith('mcp__')) return false;
      const parts = toolName.split('__');
      if (parts.length < 3) return false;
      const slug = parts[1]!;
      return !EXEMPT_SLUGS.has(slug);
    },
    resolveRequiredPath: (toolName: string, workspaceRootPath: string) => {
      const parts = toolName.split('__');
      const slug = parts[1]!;
      const guidePath = resolve(workspaceRootPath, 'sources', slug, 'guide.md');
      return existsSync(guidePath) ? guidePath : null;
    },
    blockMessage:
      'You must read the source guide before using this tool. Read {filePath} first (Read tool or `cat` in Bash), then retry.',
  },

  // API source tools: api_{slug} format
  {
    toolMatcher: (toolName: string) => {
      return toolName.startsWith('api_');
    },
    resolveRequiredPath: (toolName: string, workspaceRootPath: string) => {
      const slug = toolName.slice(4); // Remove 'api_' prefix
      const guidePath = resolve(workspaceRootPath, 'sources', slug, 'guide.md');
      return existsSync(guidePath) ? guidePath : null;
    },
    blockMessage:
      'You must read the source guide before using this tool. Please read the file at {filePath} first, then retry.',
  },

  // Built-in browser tool: require browser-tools.md first. Accept legacy split
  // names for resumed sessions, but not external MCP tools such as Playwright.
  // Skip the rule entirely when the built-in browser tool is disabled.
  {
    toolMatcher: (toolName: string) =>
      getBrowserToolEnabled() && isBrowserToolNameOrAlias(toolName),
    resolveRequiredPath: () => {
      return existsSync(BROWSER_TOOLS_DOC_PATH) ? BROWSER_TOOLS_DOC_PATH : null;
    },
    blockMessage:
      'You must read the browser tools guide before using browser automation. Please read the file at {filePath} first, then retry.',
    strict: true,
  },
];

// ============================================================
// PrerequisiteManager
// ============================================================

export class PrerequisiteManager {
  /** Max times to block a tool for the same prerequisite before allowing through */
  private static readonly MAX_REJECTIONS = 1;

  private readFiles: Set<string> = new Set();
  private readRanges = new Map<string, { version: string; total: number; ranges: Array<[number, number]> }>();
  private rejectionCounts: Map<string, number> = new Map();
  private pendingSkillPaths: Set<string> = new Set();
  private selectedSkillPaths: Set<string> = new Set();
  private workspaceRootPath: string;
  private onDebug?: (message: string) => void;

  constructor(config: PrerequisiteManagerConfig) {
    this.workspaceRootPath = config.workspaceRootPath;
    this.onDebug = config.onDebug;
  }

  /**
   * Register skill SKILL.md paths as prerequisites.
   * All tool calls (except Read, and Bash reading one of these files) are blocked
   * until the files have been read.
   */
  registerSkillPrerequisites(paths: string[]): void {
    for (const path of paths) {
      const expanded = expandPath(path);
      this.pendingSkillPaths.add(expanded);
      this.selectedSkillPaths.add(expanded);
      this.onDebug?.(`Prerequisite: registered skill prerequisite ${expanded}`);
    }
  }

  /**
   * Check if a tool call's prerequisites are met.
   * Iterates rules, checks if required files have been read.
   * After MAX_REJECTIONS blocks for the same path, allows through gracefully.
   */
  checkPrerequisites(toolName: string): PrerequisiteCheckResult {
    // Check dynamic skill prerequisites first
    const skillResult = this.checkSkillPrerequisites(toolName);
    if (!skillResult.allowed) return skillResult;

    for (const rule of RULES) {
      if (!rule.toolMatcher(toolName)) continue;

      const requiredPath = rule.resolveRequiredPath(toolName, this.workspaceRootPath);
      if (!requiredPath) continue; // No guide.md exists, skip

      if (!this.hasRead(requiredPath)) {
        const count = (this.rejectionCounts.get(requiredPath) ?? 0) + 1;
        this.rejectionCounts.set(requiredPath, count);

        const blockReason = rule.blockMessage.replace('{filePath}', requiredPath);

        if (rule.strict) {
          this.onDebug?.(`Prerequisite blocked (strict): ${toolName} requires ${requiredPath}`);
          return { allowed: false, blockReason };
        }

        if (count <= PrerequisiteManager.MAX_REJECTIONS) {
          this.onDebug?.(`Prerequisite blocked (${count}/${PrerequisiteManager.MAX_REJECTIONS}): ${toolName} requires ${requiredPath}`);
          return { allowed: false, blockReason };
        }
        // Exceeded max rejections — allow through gracefully
        this.onDebug?.(`Prerequisite: allowing ${toolName} after ${count} rejections (max reached)`);
      }
    }

    return { allowed: true };
  }

  /**
   * Check dynamic skill prerequisites.
   * If pending skill paths exist and the tool is NOT a Read targeting one of them, block.
   */
  private checkSkillPrerequisites(toolName: string): PrerequisiteCheckResult {
    for (const path of this.selectedSkillPaths) if (!this.hasRead(path)) this.pendingSkillPaths.add(path);
    if (this.pendingSkillPaths.size === 0) return { allowed: true };

    // Allow Read tool through — trackReadTool will clear the prerequisite
    if (['Read', 'Grep', 'Glob', 'LS', 'tool_search', 'report_progress', 'mcp__session__ask_user'].includes(toolName)) return { allowed: true };

    const pendingList = [...this.pendingSkillPaths].join(', ');
    const key = `skill:${pendingList}`;
    const count = (this.rejectionCounts.get(key) ?? 0) + 1;
    this.rejectionCounts.set(key, count);

    if (count <= PrerequisiteManager.MAX_REJECTIONS) {
      const blockReason = `You must read the skill instruction files before proceeding. Use Read or \`cat\` via Bash to read: ${pendingList}`;
      this.onDebug?.(`Skill prerequisite blocked (${count}/${PrerequisiteManager.MAX_REJECTIONS}): ${toolName} — pending: ${pendingList}`);
      return { allowed: false, blockReason };
    }

    // Exceeded max rejections — allow through and clear
    this.onDebug?.(`Skill prerequisite: allowing ${toolName} after ${count} rejections (max reached)`);
    // A recovery fallback is not proof of delivery. Keep the selected skill pending.
    return { allowed: true };
  }

  /**
   * Track a Read tool call. Extracts file_path from tool input,
   * normalizes it, and adds to the read set.
   * Also clears matching pending skill paths.
   */
  trackReadTool(toolInput: Record<string, unknown>, resultText?: string, provenance?: ToolResultProvenance): void {
    if (provenance) {
      const { coverage, source, modelView } = provenance;
      if (!source.sha256 || modelView.kind === 'preview' || coverage.kind === 'unknown') return;
      const path = source.path ?? toolInput.file_path ?? toolInput.path;
      if (typeof path !== 'string' || !coverage.totalLines || coverage.startLine === undefined || coverage.endLine === undefined) return;
      const expanded = expandPath(path);
      let entry = this.readRanges.get(expanded);
      if (!entry || entry.version !== source.sha256) {
        this.readFiles.delete(expanded);
        entry = { version: source.sha256, total: coverage.totalLines, ranges: [] };
        this.readRanges.set(expanded, entry);
      }
      for (const [alias, record] of this.readRanges) {
        if (record.version !== source.sha256 || record.total !== coverage.totalLines) continue;
        record.ranges.push([coverage.startLine, coverage.endLine]);
        record.ranges.sort((a, b) => a[0] - b[0]);
        let end = 0;
        for (const [start, finish] of record.ranges) { if (start > end + 1) break; end = Math.max(end, finish); }
        if (end >= record.total) this.markRead(alias, 'Read');
      }
      return;
    }
    if (resultText && isDerivedRead(resultText)) return;
    // Legacy in-process callers without text retain their explicit acknowledgement API.
    // A protocol result without provenance cannot establish a complete provider view.
    if (resultText !== undefined) return;
    // A bounded or ranged read does not establish that the instructions were loaded.
    if (toolInput.limit !== undefined || (typeof toolInput.offset === 'number' && toolInput.offset > 1)) return;
    if (resultText && /\[[^\]\n]*(?:Use offset=\d+ to continue|exceeds[^\]\n]*limit)[^\]\n]*\]/i.test(resultText)) return;
    const filePath = (toolInput.file_path as string) || (toolInput.path as string);
    if (!filePath) return;

    const expanded = expandPath(filePath);
    this.readFiles.add(expanded);

    // Clear matching pending skill path
    if (this.pendingSkillPaths.has(expanded)) {
      this.pendingSkillPaths.delete(expanded);
      this.onDebug?.(`Prerequisite: cleared skill prerequisite ${expanded}`);
    }

    this.onDebug?.(`Prerequisite: tracked read of ${expanded}`);
  }

  /**
   * Check if a Bash command is reading a pending skill file.
   * A match permits recovery reading, without acknowledging content delivery.
   * Called from the pre-tool-use pipeline to allow targeted Bash reads through.
   */
  trackBashSkillRead(input: Record<string, unknown>): boolean {
    const command = input.command as string;
    if (!command || this.pendingSkillPaths.size === 0) return false;

    // Commands and registered paths can use either separator (notably Windows
    // root-relative paths expand to backslashes while test/LLM commands commonly
    // use forward slashes). Compare both raw and separator-normalized forms.
    const normalizedCommand = command.replace(/\\/g, '/')

    let matched = false;
    for (const path of this.pendingSkillPaths) {
      const normalizedPath = path.replace(/\\/g, '/')
      if (command.includes(path) || normalizedCommand.includes(normalizedPath)) {
        // Permit a recovery read; command text is not evidence of successful delivery.
        matched = true;
      }
    }
    return matched;
  }

  /**
   * Reset read state. Called on context compaction since the LLM
   * loses the guide content and needs to re-read.
   * Preserve explicitly selected skills while invalidating their current content.
   */
  resetReadState(): void {
    const count = this.readFiles.size;
    const skillCount = this.pendingSkillPaths.size;
    this.readFiles.clear();
    this.readRanges.clear();
    this.rejectionCounts.clear();
    this.pendingSkillPaths.clear();
    for (const path of this.selectedSkillPaths) this.pendingSkillPaths.add(path);
    this.onDebug?.(`Prerequisite: reset read state (cleared ${count} reads, ${skillCount} skill prerequisites)`);
  }

  /**
   * Check if a specific file has been read (for testing).
   */
  hasRead(filePath: string): boolean {
    const path = expandPath(filePath);
    const record = this.readRanges.get(path);
    if (record && this.readFiles.has(path)) {
      try {
        if (createHash('sha256').update(readFileSync(path)).digest('hex') !== record.version) this.readFiles.delete(path);
      } catch { this.readFiles.delete(path); }
    }
    return this.readFiles.has(path);
  }

  checkBashPrerequisites(command: string): PrerequisiteCheckResult {
    const paths = getBashReadPaths(command);
    if (!paths.some((path) => this.pendingSkillPaths.has(path))) {
      const result = this.checkPrerequisites('Bash');
      if (!result.allowed) return result; // held at the skill gate, so nothing was read
    }
    return { allowed: true };
  }

  trackSuccessfulBashRead(command: string): void {
    // Arbitrary shell output has no reliable version/range contract. Use native Read.
    void command;
  }

  private markRead(path: string, via: 'Read' | 'Bash'): void {
    this.readFiles.add(path);
    if (this.pendingSkillPaths.delete(path)) {
      this.onDebug?.(`Prerequisite: cleared skill prerequisite via ${via}: ${path}`);
    }
    this.onDebug?.(`Prerequisite: tracked read of ${path} (${via})`);
  }
}

const FILE_READERS = new Set(['cat', 'bat', 'less', 'more', 'nl', 'head', 'tail', 'sed']);

const MENTIONS_FILE_READER = new RegExp(`\\b(?:${[...FILE_READERS].join('|')})\\b`);

const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/;

interface ShellWord {
  type: 'Word';
  text: string;
  expansion?: Array<{ type: string; parameter?: string }>;
}

interface ShellRedirect {
  type: 'Redirect';
  op: { text: string };
  file: ShellWord;
  numberIo?: { text: string };
}

interface ShellNode {
  type: string;
  /** Script, CompoundList, Pipeline */
  commands?: ShellNode[];
  /** Subshell */
  list?: ShellNode;
  /** LogicalExpression */
  left?: ShellNode;
  right?: ShellNode;
  /** Command */
  name?: ShellWord;
  prefix?: Array<{ type: string }>;
  suffix?: Array<{ type: string }>;
  async?: boolean;
}

function getBashReadPaths(command: string): string[] {
  // bash-parser parses heredoc bodies as commands, so their lines would look like reads.
  if (!MENTIONS_FILE_READER.test(command) || command.includes('<<')) return [];
  const paths: string[] = [];
  try {
    collectReads(bashParser(command) as ShellNode, paths);
  } catch {
    return []; // unparseable: count nothing
  }
  return paths;
}

function collectReads(node: ShellNode, paths: string[]): void {
  switch (node.type) {
    case 'Script':
    case 'CompoundList':
      // A shell's exit code proves only its final command succeeded.
      if (node.commands?.length === 1) collectReads(node.commands[0]!, paths);
      break;
    case 'Subshell':
      if (node.list) collectReads(node.list, paths);
      break;
    case 'LogicalExpression':
      // A successful shell result cannot tell which conditional branch ran.
      break;
    case 'Pipeline': {
      // The output reaches the model only if every later command is a reader too (`| head -50`).
      const commands = node.commands ?? [];
      commands.forEach((child, i) => {
        if (commands.slice(i + 1).every((next) => readerFiles(next) !== null)) collectReads(child, paths);
      });
      break;
    }
    case 'Command':
      paths.push(...(readerFiles(node) ?? []));
      break;
  }
}

function readerFiles(node: ShellNode): string[] | null {
  if (node.type !== 'Command' || !node.name || node.async) return null;
  const redirects = [...(node.prefix ?? []), ...(node.suffix ?? [])].filter(
    (item): item is ShellRedirect => item.type === 'Redirect',
  );
  if (redirects.some(sendsStdoutToFile)) return null;

  const words = (node.suffix ?? []).filter((item): item is ShellWord => item.type === 'Word');
  let argv = [node.name, ...words].map(shellWordText);
  // `command cat` runs cat; `command -v cat` only looks it up (and is no reader below).
  if (argv[0] === 'command') argv = argv.slice(argv[1] === '-p' ? 2 : 1);
  const name = argv[0] ? basename(argv[0]) : null; // also /bin/cat, /usr/bin/sed
  if (!name || !FILE_READERS.has(name)) return null;

  const operands = name === 'sed' ? sedInputFiles(argv.slice(1)) : readerOperands(argv.slice(1));
  if (!operands) return null;
  for (const redirect of redirects) {
    if (redirect.op.text === '<') operands.push(shellWordText(redirect.file));
  }
  return operands.flatMap((operand) => {
    const path = operand === null ? null : toReadPath(operand);
    return path ? [path] : [];
  });
}

function sendsStdoutToFile(redirect: ShellRedirect): boolean {
  if ((redirect.numberIo?.text ?? '1') !== '1') return false;
  if (redirect.op.text === '>&') return !/^\d+$/.test(redirect.file.text);
  return redirect.op.text === '>' || redirect.op.text === '>>' || redirect.op.text === '>|';
}

function shellWordText(word: ShellWord): string | null {
  if (!word.expansion) return word.text;
  if (word.expansion.some((part) => part.type !== 'ParameterExpansion' || part.parameter !== 'HOME')) return null;
  return word.text.replace(/["']/g, '');
}

function readerOperands(args: Array<string | null>): Array<string | null> {
  const end = args.indexOf('--');
  const options = end === -1 ? args : args.slice(0, end);
  const rest = end === -1 ? [] : args.slice(end + 1);
  return [...options.filter((arg) => !arg?.startsWith('-')), ...rest];
}

function sedInputFiles(args: Array<string | null>): Array<string | null> | null {
  const operands: Array<string | null> = [];
  let scriptFromOption = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? null;
    if (arg === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (arg?.startsWith('--')) {
      const option = arg.split('=', 1)[0];
      if (option === '--in-place') return null;
      if (option === '--expression' || option === '--file') {
        scriptFromOption = true;
        if (!arg.includes('=')) i++;
      }
    } else if (arg?.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        if (arg[j] === 'i' || arg[j] === 'I') return null;
        if (arg[j] === 'e' || arg[j] === 'f') {
          scriptFromOption = true;
          if (j === arg.length - 1) i++; // the script is the next argument
          break;
        }
      }
    } else {
      operands.push(arg);
    }
  }
  return scriptFromOption ? operands : operands.slice(1);
}

function toReadPath(operand: string): string | null {
  return isAbsolute(operand) || HOME_PREFIX.test(operand) ? expandPath(operand) : null;
}

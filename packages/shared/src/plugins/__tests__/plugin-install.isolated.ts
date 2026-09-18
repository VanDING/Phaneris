/**
 * Module B acceptance tests — installation, materialization, and placeholder resolution.
 *
 * The behaviours pinned here are the ones whose failure is silent in production:
 * placeholder expansion (a wrong path looks like a server that "just doesn't
 * start"), directory-level replace (a file merge leaves deleted files readable),
 * `data/` preservation (a reinstall silently wipes plugin state), and the
 * per-entry failure boundaries (one bad server must not sink the package).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllSkills } from '../../skills/storage.ts';
import { loadSourceConfig, loadWorkspaceSources } from '../../sources/storage.ts';
import { readPluginAuditLog } from '../audit.ts';
import { analyzePluginInstall, analyzePluginUninstall, installPlugin, readPluginIndex, uninstallPlugin } from '../install.ts';
import {
  expandPluginPlaceholders,
  normalizePluginCommand,
  PluginPathError,
  resolvePluginStdioFields,
  validatePluginCwd,
} from '../resolve.ts';
import { PLUGIN_MANIFEST_SCHEMA, PLUGIN_DATA_DIR_NAME } from '../types.ts';

let workspaceRoot: string;
let packageRoot: string;
let auditLogPath: string;
const originalAuditEnv = process.env.PHANERIS_PLUGIN_AUDIT_LOG;

function writePackageFile(relativePath: string, content: string): void {
  const filePath = join(packageRoot, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

function writeManifest(extra: Record<string, unknown> = {}): void {
  writePackageFile(
    'plugin.json',
    JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'demo', ...extra }, null, 2),
  );
}

function writeSkill(slug: string, description = 'A skill'): void {
  writePackageFile(
    `skills/${slug}/SKILL.md`,
    `---\nname: ${slug}\ndescription: ${description}\n---\n\nBody.\n`,
  );
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'phaneris-install-ws-'));
  const parent = mkdtempSync(join(tmpdir(), 'phaneris-install-pkg-'));
  packageRoot = join(parent, 'demo');
  mkdirSync(packageRoot, { recursive: true });

  // Keep the audit trail out of the user's real log directory.
  auditLogPath = join(workspaceRoot, 'plugin-actions.jsonl');
  process.env.PHANERIS_PLUGIN_AUDIT_LOG = auditLogPath;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(join(packageRoot, '..'), { recursive: true, force: true });

  if (originalAuditEnv === undefined) delete process.env.PHANERIS_PLUGIN_AUDIT_LOG;
  else process.env.PHANERIS_PLUGIN_AUDIT_LOG = originalAuditEnv;
});

// ============================================================================
// Placeholder resolution (design §5.4)
// ============================================================================

describe('plugin placeholder resolution', () => {
  // A real, native directory: `isPathWithin` resolves both sides, so a synthetic
  // POSIX root is meaningless on Windows. Expansion normalizes separators, so
  // expectations are built with `join`.
  const PLUGIN_ROOT = join(tmpdir(), 'phaneris-resolve-demo');
  const context = { pluginRoot: PLUGIN_ROOT };
  const under = (...segments: string[]): string => join(PLUGIN_ROOT, ...segments);

  it('expands PLUGIN_ROOT and PLUGIN_DATA as plain string substitutions', () => {
    expect(expandPluginPlaceholders('${PLUGIN_ROOT}/bin/server', context)).toBe(
      under('bin', 'server'),
    );
    // PLUGIN_DATA is <pluginRoot>/data, so a server takes its data dir as an
    // argument rather than needing a working directory.
    expect(expandPluginPlaceholders('${PLUGIN_DATA}', context)).toBe(under('data'));
    expect(expandPluginPlaceholders('${PLUGIN_ROOT}/data/cache.json', context)).toBe(
      under('data', 'cache.json'),
    );
  });

  it('leaves unrelated text untouched', () => {
    expect(expandPluginPlaceholders('plain-value', context)).toBe('plain-value');
    expect(expandPluginPlaceholders('${OTHER}', context)).toBe('${OTHER}');
  });

  it('resolves command, args, and env together', () => {
    const resolved = resolvePluginStdioFields(
      {
        command: '${PLUGIN_ROOT}/bin/server',
        args: ['--data', '${PLUGIN_DATA}', '--config', '${PLUGIN_ROOT}/c.json'],
        env: { CONFIG: '${PLUGIN_ROOT}/config.json', PLAIN: 'x' },
      },
      context,
    );

    expect(resolved.command).toBe(under('bin', 'server'));
    expect(resolved.args).toEqual(['--data', under('data'), '--config', under('c.json')]);
    expect(resolved.env).toEqual({ CONFIG: under('config.json'), PLAIN: 'x' });
  });

  it('normalizes a plugin-relative command to an absolute path', () => {
    expect(normalizePluginCommand('./bin/server', context)).toBe(under('bin', 'server'));
    expect(normalizePluginCommand('${PLUGIN_ROOT}/bin/server', context)).toBe(
      under('bin', 'server'),
    );
  });

  it('rejects a bare executable name (spec §7.2.1 forbids depending on PATH)', () => {
    expect(() => normalizePluginCommand('node', context)).toThrow(PluginPathError);
    expect(() => normalizePluginCommand('npx', context)).toThrow(PluginPathError);
  });

  it('rejects a command that escapes the plugin root', () => {
    expect(() => normalizePluginCommand('../bin/server', context)).toThrow(PluginPathError);
    expect(() => normalizePluginCommand('${PLUGIN_ROOT}/../../bin/server', context)).toThrow(
      PluginPathError,
    );
  });

  it('accepts an absent, dot, or PLUGIN_ROOT cwd — they all mean the plugin root', () => {
    expect(() => validatePluginCwd(undefined, context)).not.toThrow();
    expect(() => validatePluginCwd('', context)).not.toThrow();
    expect(() => validatePluginCwd('.', context)).not.toThrow();
    expect(() => validatePluginCwd('${PLUGIN_ROOT}', context)).not.toThrow();
    expect(() => validatePluginCwd('${PLUGIN_ROOT}/sub', context)).not.toThrow();
  });

  it('rejects any other cwd with an actionable message (design §5.4.1)', () => {
    expect(() => validatePluginCwd('./data', context)).toThrow(PluginPathError);
    expect(() => validatePluginCwd('${PLUGIN_DATA}', context)).toThrow(PluginPathError);
    expect(() => validatePluginCwd(join(tmpdir(), 'elsewhere'), context)).toThrow(PluginPathError);

    try {
      validatePluginCwd('${PLUGIN_DATA}', context);
    } catch (error) {
      // The message must tell the author what to do instead.
      expect((error as Error).message).toContain('${PLUGIN_DATA}');
      expect((error as Error).message).toContain('args');
    }
  });
});

// ============================================================================
// Install plan (D9 — what the user approves)
// ============================================================================

describe('analyzePluginInstall', () => {
  it('splits existing resources into overwrites and new ones into creates', () => {
    writeManifest();
    writeSkill('existing-skill');
    writeSkill('fresh-skill');

    // Pre-existing workspace skill with the same slug.
    const existingDir = join(workspaceRoot, 'skills', 'existing-skill');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(
      join(existingDir, 'SKILL.md'),
      '---\nname: existing-skill\ndescription: User version\n---\n\nMine.\n',
    );

    const plan = analyzePluginInstall(workspaceRoot, packageRoot);

    expect(plan.overwrites.map((o) => `${o.kind}:${o.slug}`)).toEqual(['skill:existing-skill']);
    expect(plan.creates.map((o) => `${o.kind}:${o.slug}`)).toEqual(['skill:fresh-skill']);
  });

  it('shows the stdio command and args verbatim, before expansion (P5-5)', () => {
    writeManifest();
    writeSkill('s');
    writePackageFile(
      'mcp.json',
      JSON.stringify({
        mcpServers: {
          local: {
            type: 'stdio',
            command: './bin/server',
            args: ['--data', '${PLUGIN_DATA}'],
          },
        },
      }),
    );

    const plan = analyzePluginInstall(workspaceRoot, packageRoot);

    expect(plan.stdioCommands).toEqual([
      { slug: 'local', command: './bin/server', args: ['--data', '${PLUGIN_DATA}'] },
    ]);
  });

  it('skips a stdio entry with an unsupported cwd but keeps the package', () => {
    writeManifest();
    writeSkill('s');
    writePackageFile(
      'mcp.json',
      JSON.stringify({
        mcpServers: {
          bad: { type: 'stdio', command: './bin/a', cwd: './data' },
          good: { type: 'stdio', command: './bin/b' },
        },
      }),
    );

    const plan = analyzePluginInstall(workspaceRoot, packageRoot);

    expect(plan.stdioCommands.map((c) => c.slug)).toEqual(['good']);
    expect(plan.warnings.some((w) => w.path.includes('bad'))).toBe(true);
  });

  it('rejects a package that contributes nothing (D3)', () => {
    writeManifest();
    expect(() => analyzePluginInstall(workspaceRoot, packageRoot)).toThrow(/contributes nothing/);
  });
});

// ============================================================================
// Install (materialization)
// ============================================================================

describe('installPlugin', () => {
  it('materializes skills into <ws>/skills and MCP servers into <ws>/sources', () => {
    writeManifest({ version: '1.0.0' });
    writeSkill('financial-modeling', 'Three-statement models');
    writePackageFile(
      'mcp.json',
      JSON.stringify({
        mcpServers: {
          'sec-edgar': {
            type: 'stdio',
            command: '${PLUGIN_ROOT}/bin/server',
            args: ['--data', '${PLUGIN_DATA}'],
          },
        },
      }),
    );

    const result = installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    expect(result.name).toBe('demo');
    expect(result.skills).toEqual(['financial-modeling']);
    expect(result.sources).toEqual(['sec-edgar']);

    // The skill is now an ordinary workspace skill — same loader, no special case.
    const skills = loadAllSkills(workspaceRoot);
    expect(skills.map((s) => s.slug)).toContain('financial-modeling');

    // The package landed in the workspace.
    expect(existsSync(join(workspaceRoot, 'plugins', 'demo', 'plugin.json'))).toBe(true);
  });

  it('stores placeholders verbatim plus a workspace-relative pluginRoot (design §5.4.3/§5.4.4)', () => {
    writeManifest();
    writeSkill('s');
    writePackageFile(
      'mcp.json',
      JSON.stringify({
        mcpServers: { local: { type: 'stdio', command: './bin/server', args: ['${PLUGIN_DATA}'] } },
      }),
    );

    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    const config = loadSourceConfig(workspaceRoot, 'local');
    expect(config?.pluginRoot).toBe('plugins/demo');
    // Not expanded at install time, so the workspace stays movable.
    expect(config?.mcp?.command).toBe('./bin/server');
    expect(config?.mcp?.args).toEqual(['${PLUGIN_DATA}']);
    expect(config?.provider).toBe('demo');
  });

  it('replaces an existing skill directory wholesale instead of merging (P5-1)', () => {
    const existingDir = join(workspaceRoot, 'skills', 'shared');
    mkdirSync(join(existingDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(existingDir, 'SKILL.md'),
      '---\nname: shared\ndescription: User version\n---\n\nMine.\n',
    );
    // A file the new version does not contain — a merge would leave it behind
    // where the loader would keep reading it.
    writeFileSync(join(existingDir, 'scripts', 'stale.sh'), '#!/bin/sh\n');

    writeManifest();
    writeSkill('shared', 'Plugin version');

    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    const installed = loadAllSkills(workspaceRoot).find((s) => s.slug === 'shared');
    expect(installed?.metadata.description).toBe('Plugin version');
    expect(existsSync(join(existingDir, 'scripts', 'stale.sh'))).toBe(false);
  });

  it('preserves the plugin data directory across a reinstall (§5.4.7)', () => {
    writeManifest();
    writeSkill('s');

    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    // The plugin's server writes persistent state here.
    const dataFile = join(workspaceRoot, 'plugins', 'demo', PLUGIN_DATA_DIR_NAME, 'state.json');
    mkdirSync(join(dataFile, '..'), { recursive: true });
    writeFileSync(dataFile, '{"seen":1}');

    // Reinstall from the package directory (now the installed copy).
    const installedRoot = join(workspaceRoot, 'plugins', 'demo');
    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, installedRoot));

    expect(existsSync(dataFile)).toBe(true);
    expect(readFileSync(dataFile, 'utf-8')).toBe('{"seen":1}');
  });

  it('rebuilds the derived reverse index (D10)', () => {
    writeManifest();
    writeSkill('a-skill');
    writePackageFile(
      'mcp.json',
      JSON.stringify({ mcpServers: { 'a-source': { type: 'stdio', command: './bin/s' } } }),
    );

    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    const index = readPluginIndex(workspaceRoot);
    expect(index.resources.skills['a-skill']).toEqual(['demo']);
    expect(index.resources.sources['a-source']).toEqual(['demo']);
  });

  it('leaves no staging directories behind after a successful install', () => {
    writeManifest();
    writeSkill('clean');

    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    const leftover = readdirSync(join(workspaceRoot, 'skills'))
      .filter((name) => name.startsWith('.tmp-plugin-'));
    expect(leftover).toEqual([]);
  });

  it('rejects a package containing a symbolic link before writing anything (D11)', () => {
    writeManifest();
    writeSkill('s');

    const outside = mkdtempSync(join(tmpdir(), 'phaneris-outside-'));
    try {
      symlinkSync(outside, join(packageRoot, 'linked'));
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return; // Windows without developer mode cannot create symlinks.
    }

    expect(() => analyzePluginInstall(workspaceRoot, packageRoot)).toThrow(/symbolic link/);
    expect(existsSync(join(workspaceRoot, 'skills', 's'))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  it('writes a one-line audit record naming the stdio command (P5-4)', () => {
    writeManifest({ version: '2.0.0' });
    writeSkill('audited');
    writePackageFile(
      'mcp.json',
      JSON.stringify({ mcpServers: { runner: { type: 'stdio', command: './bin/run', args: ['--x'] } } }),
    );

    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    const entries = readPluginAuditLog();
    const last = entries.at(-1);
    expect(last?.action).toBe('install');
    expect(last?.plugin).toBe('demo');
    expect(last?.version).toBe('2.0.0');
    expect(last?.stdioCommands).toEqual([
      { slug: 'runner', command: './bin/run', args: ['--x'] },
    ]);
  });

  it('makes the materialized source addressable by the ordinary source loader', () => {
    writeManifest();
    writeSkill('s');
    writePackageFile(
      'mcp.json',
      JSON.stringify({
        mcpServers: { remote: { type: 'streamable-http', url: 'https://example.com/mcp' } },
      }),
    );

    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    const sources = loadWorkspaceSources(workspaceRoot);
    const remote = sources.find((s) => s.config.slug === 'remote');
    expect(remote?.config.type).toBe('mcp');
    expect(remote?.config.mcp?.url).toBe('https://example.com/mcp');
  });
});

// ============================================================================
// P9-4 — uninstall leaves no orphans and never deletes a shared resource
// ============================================================================

describe('P9-4: uninstall and reference counting (D10)', () => {
  /** Install a second package that shares a resource with `demo`. */
  function installSecondPlugin(
    name: string,
    build: (root: string) => void,
  ): void {
    const parent = mkdtempSync(join(tmpdir(), 'phaneris-install-pkg2-'));
    const root = join(parent, name);
    mkdirSync(root, { recursive: true });

    writeFileSync(
      join(root, 'plugin.json'),
      JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name }),
    );
    build(root);
    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, root));
  }

  it('deletes resources only this plugin provided', () => {
    writeManifest();
    writeSkill('exclusive-skill');
    writePackageFile(
      'mcp.json',
      JSON.stringify({ mcpServers: { 'exclusive-source': { type: 'stdio', command: './bin/s' } } }),
    );
    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    const result = uninstallPlugin(workspaceRoot, 'demo');

    expect(result.removedSkills).toEqual(['exclusive-skill']);
    expect(result.removedSources).toEqual(['exclusive-source']);
    expect(existsSync(join(workspaceRoot, 'skills', 'exclusive-skill'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'sources', 'exclusive-source'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'plugins', 'demo'))).toBe(false);
  });

  it('keeps a skill another installed plugin still references', () => {
    writeManifest();
    writeSkill('shared-skill');
    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    // A second package that also ships the same skill slug.
    installSecondPlugin('other', (root) => {
      const dir = join(root, 'skills', 'shared-skill');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'SKILL.md'),
        '---\nname: shared-skill\ndescription: Same skill\n---\n\nBody.\n',
      );
    });

    const result = uninstallPlugin(workspaceRoot, 'demo');

    expect(result.retained.map((r) => `${r.kind}:${r.slug}`)).toEqual(['skill:shared-skill']);
    expect(result.removedSkills).toEqual([]);
    expect(existsSync(join(workspaceRoot, 'skills', 'shared-skill'))).toBe(true);
    // The remaining plugin is untouched.
    expect(existsSync(join(workspaceRoot, 'plugins', 'other'))).toBe(true);
  });

  it('deletes the shared resource once the last referencing plugin goes', () => {
    writeManifest();
    writeSkill('shared-skill');
    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    installSecondPlugin('other', (root) => {
      const dir = join(root, 'skills', 'shared-skill');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'SKILL.md'),
        '---\nname: shared-skill\ndescription: Same skill\n---\n\nBody.\n',
      );
    });

    uninstallPlugin(workspaceRoot, 'demo');
    expect(existsSync(join(workspaceRoot, 'skills', 'shared-skill'))).toBe(true);

    const second = uninstallPlugin(workspaceRoot, 'other');
    expect(second.removedSkills).toEqual(['shared-skill']);
    expect(existsSync(join(workspaceRoot, 'skills', 'shared-skill'))).toBe(false);
  });

  it('leaves no orphans and keeps the derived index self-consistent', () => {
    writeManifest();
    writeSkill('alpha');
    writePackageFile(
      'mcp.json',
      JSON.stringify({ mcpServers: { 'alpha-source': { type: 'stdio', command: './bin/a' } } }),
    );
    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    uninstallPlugin(workspaceRoot, 'demo');

    // No plugin claims anything any more.
    const index = readPluginIndex(workspaceRoot);
    expect(index.resources.skills).toEqual({});
    expect(index.resources.sources).toEqual({});

    // And the loaders no longer see the removed resources. (loadAllSkills also
    // reads the machine's real ~/.agents/skills, so assert absence, not emptiness.)
    expect(loadAllSkills(workspaceRoot).map((s) => s.slug)).not.toContain('alpha');
    expect(loadWorkspaceSources(workspaceRoot).map((s) => s.config.slug)).not.toContain(
      'alpha-source',
    );
  });

  it('recovers when the derived index is deleted outright', () => {
    writeManifest();
    writeSkill('resilient');
    installPlugin(workspaceRoot, analyzePluginInstall(workspaceRoot, packageRoot));

    // The index is derived: deleting it must lose nothing.
    rmSync(join(workspaceRoot, 'plugins', '_index.json'), { force: true });

    const rebuilt = readPluginIndex(workspaceRoot);
    expect(rebuilt.resources.skills['resilient']).toEqual(['demo']);

    const result = uninstallPlugin(workspaceRoot, 'demo');
    expect(result.removedSkills).toEqual(['resilient']);
  });

  it('rejects uninstalling a plugin that is not installed', () => {
    expect(() => analyzePluginUninstall(workspaceRoot, 'ghost')).toThrow(/not installed/);
  });
});

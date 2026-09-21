/**
 * P9-1 — plugins/ content must never be scanned by the skill or source loaders.
 *
 * A plugin root is a *package*, not a resource tier: its `skills/` and `mcp.json`
 * describe what to materialize, they are not themselves workspace resources.
 * If a loader ever walked into `plugins/`, skills inside a package would appear
 * in the Skills panel with no provenance and duplicate the materialized copies.
 *
 * This file also pins the manifest failure boundaries from Agent Plugins §5,
 * because those decide whether a plugin is loadable at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllSkills } from '../../skills/storage.ts';
import { loadWorkspaceSources } from '../../sources/storage.ts';
import { loadAllPlugins, loadPlugin, listPluginNames } from '../storage.ts';
import { PLUGIN_MANIFEST_SCHEMA } from '../types.ts';
import { isValidPluginName, validatePluginManifest } from '../validation.ts';

let workspaceRoot: string;

function writePluginFile(pluginName: string, relativePath: string, content: string): void {
  const filePath = join(workspaceRoot, 'plugins', pluginName, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

function writeManifest(pluginName: string, extra: Record<string, unknown> = {}): void {
  writePluginFile(
    pluginName,
    'plugin.json',
    JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: pluginName, ...extra }, null, 2),
  );
}

/** A minimal valid skill: Agent Skills requires `name` to equal the directory. */
function writeSkill(pluginName: string, slug: string, description = 'Does a thing'): void {
  writePluginFile(
    pluginName,
    `skills/${slug}/SKILL.md`,
    `---\nname: ${slug}\ndescription: ${description}\n---\n\nInstructions here.\n`,
  );
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'phaneris-plugin-'));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

// ============================================================================
// P9-1 — loader isolation
// ============================================================================

describe('P9-1: plugins/ is isolated from the resource loaders', () => {
  it('does not expose a packaged skill as a workspace skill', () => {
    writeManifest('demo');
    writeSkill('demo', 'packaged-skill');

    const skills = loadAllSkills(workspaceRoot);
    expect(skills.map((s) => s.slug)).not.toContain('packaged-skill');
  });

  it('does expose a materialized skill once it lands in <ws>/skills/', () => {
    writeManifest('demo');
    writeSkill('demo', 'materialized-skill');

    // Materialization is a plain directory copy (D4).
    const target = join(workspaceRoot, 'skills', 'materialized-skill');
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, 'SKILL.md'),
      '---\nname: materialized-skill\ndescription: Materialized\n---\n\nBody.\n',
    );

    const skills = loadAllSkills(workspaceRoot);
    expect(skills.map((s) => s.slug)).toContain('materialized-skill');
  });

  it('does not expose a plugin mcp.json as a workspace source', () => {
    writeManifest('demo');
    writePluginFile(
      'demo',
      'mcp.json',
      JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: { 'packaged-server': { type: 'stdio', command: './bin/server' } },
      }),
    );

    const sources = loadWorkspaceSources(workspaceRoot);
    expect(sources.map((s) => s.config.slug)).not.toContain('packaged-server');
  });
});

// ============================================================================
// Manifest failure boundaries (Agent Plugins §5)
// ============================================================================

describe('plugin manifest validation', () => {
  it('accepts a minimal manifest', () => {
    const result = validatePluginManifest({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'minimal' });
    expect(result.manifest?.name).toBe('minimal');
    expect(result.errors).toEqual([]);
  });

  it('accepts an optional emoji icon in the manifest', () => {
    const result = validatePluginManifest({
      $schema: PLUGIN_MANIFEST_SCHEMA,
      name: 'iconic',
      icon: '📊',
    });
    expect(result.manifest?.icon).toBe('📊');
  });

  it('rejects a missing $schema or name', () => {
    expect(validatePluginManifest({ name: 'x' }).manifest).toBeNull();
    expect(validatePluginManifest({ $schema: PLUGIN_MANIFEST_SCHEMA }).manifest).toBeNull();
  });

  it('rejects an unsupported $schema version', () => {
    const result = validatePluginManifest({
      $schema: 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json',
      name: 'future',
    });
    expect(result.manifest).toBeNull();
    expect(result.errors.join(' ')).toContain('unsupported $schema');
  });

  it('reports unknown top-level fields and still loads (spec §5.2)', () => {
    const result = validatePluginManifest({
      $schema: PLUGIN_MANIFEST_SCHEMA,
      name: 'extra',
      somethingNew: true,
    });
    expect(result.manifest?.name).toBe('extra');
    expect(result.warnings.join(' ')).toContain('somethingNew');
  });

  it('treats a non-object extensions field as absent, not fatal (spec §8.1)', () => {
    const result = validatePluginManifest({
      $schema: PLUGIN_MANIFEST_SCHEMA,
      name: 'ext',
      extensions: ['not', 'an', 'object'],
    });
    expect(result.manifest).not.toBeNull();
    expect(result.manifest?.extensions).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('extensions');
  });

  it('rejects a non-string metadata field (type-only validation)', () => {
    expect(
      validatePluginManifest({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'x', version: 1 }).manifest,
    ).toBeNull();
  });

  it('does not reject a non-SemVer version or a non-URL homepage (spec §5.4)', () => {
    const result = validatePluginManifest({
      $schema: PLUGIN_MANIFEST_SCHEMA,
      name: 'lenient',
      version: 'not-semver',
      homepage: 'not a url',
      license: 'not-an-spdx-id',
    });
    expect(result.manifest).not.toBeNull();
  });

  it('rejects an author object with unknown fields (closed object)', () => {
    const result = validatePluginManifest({
      $schema: PLUGIN_MANIFEST_SCHEMA,
      name: 'authored',
      author: { name: 'A', nickname: 'B' },
    });
    expect(result.manifest).toBeNull();
  });

  it('applies the spec §5.5 name constraints', () => {
    expect(isValidPluginName('my-plugin')).toBe(true);
    expect(isValidPluginName('acme.tools')).toBe(true);
    expect(isValidPluginName('lint3r')).toBe(true);
    expect(isValidPluginName('a')).toBe(true);

    expect(isValidPluginName('My-Plugin')).toBe(false); // uppercase
    expect(isValidPluginName('-start')).toBe(false); // leading hyphen
    expect(isValidPluginName('end-')).toBe(false); // trailing hyphen
    expect(isValidPluginName('has--double')).toBe(false); // consecutive hyphens
    expect(isValidPluginName('too.many..dots')).toBe(false); // consecutive periods
    expect(isValidPluginName('')).toBe(false);
    expect(isValidPluginName('x'.repeat(65))).toBe(false);
  });
});

// ============================================================================
// Loading behaviour
// ============================================================================

describe('loadPlugin', () => {
  it('loads a bundle with skills, MCP servers, and a prompt fragment', () => {
    writeManifest('investment-analyst', { version: '1.2.0', description: 'Analyst toolkit' });
    writeSkill('investment-analyst', 'financial-modeling', 'Build three-statement models');
    writeSkill('investment-analyst', 'equity-research', 'Equity research framework');
    writePluginFile(
      'investment-analyst',
      'mcp.json',
      JSON.stringify({
        mcpServers: {
          'sec-edgar': { type: 'streamable-http', url: 'https://example.com/mcp' },
        },
      }),
    );
    writePluginFile('investment-analyst', 'PROMPT.md', 'Always cite sources.\n');
    writePluginFile(
      'investment-analyst',
      'phaneris/sources.json',
      JSON.stringify([{ slug: 'yfinance', type: 'api' }]),
    );

    const result = loadPlugin(workspaceRoot, 'investment-analyst');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { plugin } = result;
    expect(plugin.name).toBe('investment-analyst');
    expect(plugin.manifest.version).toBe('1.2.0');
    expect(plugin.resources.skills.map((s) => s.slug)).toEqual([
      'equity-research',
      'financial-modeling',
    ]);
    expect(plugin.resources.skills.find((s) => s.slug === 'financial-modeling')?.description).toBe(
      'Build three-statement models',
    );
    expect(plugin.resources.mcpServers.map((s) => s.slug)).toEqual(['sec-edgar']);
    expect(plugin.resources.extensionSources.map((s) => s.slug)).toEqual(['yfinance']);
    expect(plugin.promptFragment?.trim()).toBe('Always cite sources.');
    expect(plugin.workspaceRelativePath.replace(/\\/g, '/')).toBe('plugins/investment-analyst');
  });

  it('treats every fixed component location as optional (spec §6.2)', () => {
    writeManifest('empty-but-valid');

    const result = loadPlugin(workspaceRoot, 'empty-but-valid');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.resources.skills).toEqual([]);
    expect(result.plugin.resources.mcpServers).toEqual([]);
    expect(result.plugin.promptFragment).toBeNull();
  });

  it('rejects a manifest name that differs from the directory name (P2-2)', () => {
    writePluginFile(
      'dir-name',
      'plugin.json',
      JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'other-name' }),
    );

    const result = loadPlugin(workspaceRoot, 'dir-name');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('does not match directory name');
  });

  it('skips a skill whose name differs from its directory (P2-3)', () => {
    writeManifest('mismatched');
    writePluginFile(
      'mismatched',
      'skills/dir-slug/SKILL.md',
      '---\nname: other-slug\ndescription: Mismatch\n---\n\nBody.\n',
    );

    const result = loadPlugin(workspaceRoot, 'mismatched');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.resources.skills).toEqual([]);
    expect(result.plugin.warnings.some((w) => w.message.includes('does not match directory'))).toBe(true);
  });

  it('skips a skill without valid frontmatter but keeps the rest (spec §7.1)', () => {
    writeManifest('partial');
    writePluginFile('partial', 'skills/broken/SKILL.md', 'no frontmatter here');
    writeSkill('partial', 'good', 'A valid skill');

    const result = loadPlugin(workspaceRoot, 'partial');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.resources.skills.map((s) => s.slug)).toEqual(['good']);
  });

  it('disables MCP but keeps other components when mcp.json is unreadable (spec §7.2.2)', () => {
    writeManifest('bad-mcp');
    writeSkill('bad-mcp', 'still-works');
    writePluginFile('bad-mcp', 'mcp.json', '{ not json');

    const result = loadPlugin(workspaceRoot, 'bad-mcp');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.resources.mcpServers).toEqual([]);
    expect(result.plugin.resources.skills.map((s) => s.slug)).toEqual(['still-works']);
  });

  it('skips an individual invalid MCP server and keeps the others (spec §7.2.2)', () => {
    writeManifest('mixed-mcp');
    writePluginFile(
      'mixed-mcp',
      'mcp.json',
      JSON.stringify({
        mcpServers: {
          good: { type: 'stdio', command: './bin/good' },
          'no-command': { type: 'stdio' },
          'bad-transport': { type: 'carrier-pigeon' },
          remote: { type: 'sse', url: 'https://example.com/sse' },
        },
      }),
    );

    const result = loadPlugin(workspaceRoot, 'mixed-mcp');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.resources.mcpServers.map((s) => s.slug).sort()).toEqual(['good', 'remote']);
  });

  it('rejects a package containing a symbolic link (D11)', () => {
    writeManifest('has-symlink');
    writeSkill('has-symlink', 'fine');

    const outside = mkdtempSync(join(tmpdir(), 'phaneris-outside-'));
    try {
      symlinkSync(outside, join(workspaceRoot, 'plugins', 'has-symlink', 'linked'));
    } catch {
      // Windows without developer mode cannot create symlinks; the case is vacuous there.
      rmSync(outside, { recursive: true, force: true });
      return;
    }

    const result = loadPlugin(workspaceRoot, 'has-symlink');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('symbolic link');
    rmSync(outside, { recursive: true, force: true });
  });

  it('does not follow a symlinked skill directory out of the plugin root', () => {
    writeManifest('escaping-skill');
    const outside = mkdtempSync(join(tmpdir(), 'phaneris-outside-skill-'));
    writeFileSync(
      join(outside, 'SKILL.md'),
      '---\nname: escaped\ndescription: From outside\n---\n\nBody.\n',
    );

    try {
      mkdirSync(join(workspaceRoot, 'plugins', 'escaping-skill', 'skills'), { recursive: true });
      symlinkSync(outside, join(workspaceRoot, 'plugins', 'escaping-skill', 'skills', 'escaped'));
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return;
    }

    const result = loadPlugin(workspaceRoot, 'escaping-skill');
    // The symlinked entry is rejected outright (D11), so nothing is materialized from it.
    expect(result.ok).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  it('returns an error for a missing plugin', () => {
    const result = loadPlugin(workspaceRoot, 'nope');
    expect(result.ok).toBe(false);
  });
});

describe('loadAllPlugins', () => {
  it('returns valid plugins and reports broken ones separately', () => {
    writeManifest('good-one');
    writeSkill('good-one', 'a-skill');
    mkdirSync(join(workspaceRoot, 'plugins', 'broken-one'), { recursive: true });
    writePluginFile('broken-one', 'plugin.json', '{ not json');

    expect(listPluginNames(workspaceRoot).sort()).toEqual(['broken-one', 'good-one']);

    const { plugins, errors } = loadAllPlugins(workspaceRoot);
    expect(plugins.map((p) => p.name)).toEqual(['good-one']);
    expect(errors.map((e) => e.path)).toEqual(['plugin.json']);
  });

  it('returns empty results when no plugins directory exists', () => {
    const { plugins, errors } = loadAllPlugins(workspaceRoot);
    expect(plugins).toEqual([]);
    expect(errors).toEqual([]);
  });
});

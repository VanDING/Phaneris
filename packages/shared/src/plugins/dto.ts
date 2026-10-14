/**
 * Plugin DTO projection
 *
 * One place that turns a loaded bundle into the shape the renderer consumes.
 * Both the `plugins:list` RPC and the `plugins:changed` push go through this, so
 * the sidebar cannot receive two differently-shaped descriptions of the same
 * plugin — the kind of drift that shows up as a field that is present on load
 * and missing after an install.
 *
 * Manifest internals stay out of the list DTO, while the resident `promptFragment`
 * is projected so the plugin detail view can show and edit its current content.
 */

import type { LoadedPlugin } from './types.ts';
import { buildPluginRoster } from './plugin-context.ts';
import { compilePluginSources } from './install.ts';
import { loadSourceConfig } from '../sources/storage.ts';
import { validateSourceConfig } from '../config/source-validation.ts';
import { statSync } from 'node:fs';
import { normalizePluginCommand } from './resolve.ts';

export type PluginAvailability = 'configured' | 'missing' | 'needs-configuration' | 'needs-authentication' | 'missing-executable' | 'disabled' | 'not-connected' | 'connection-failed';

/** One plugin bundle as the renderer sees it. Mirrors `PluginSummary` in the electron app. */
export interface PluginSummaryDto {
  /** Directory name; equals the manifest `name` (P2-2). */
  name: string;
  description?: string;
  icon?: string;
  version?: string;
  author?: string;
  license?: string;
  homepage?: string;
  /** Absolute path to the plugin root. */
  path: string;
  /** Workspace-relative plugin root, e.g. `plugins/my-plugin` (design §5.4.4). */
  workspaceRelativePath: string;
  skills: Array<{ slug: string; name: string; description: string; availability?: PluginAvailability }>;
  sources: Array<{ slug: string; type: 'mcp' | 'api' | 'local'; availability?: PluginAvailability }>;
  hasPromptFragment: boolean;
  promptFragment?: string;
  warnings: Array<{ path: string; message: string }>;
}

/** Project a loaded bundle into its renderer-facing summary. */
export function summarizePluginForRenderer(plugin: LoadedPlugin): PluginSummaryDto {
  const roster = buildPluginRoster(plugin);
  let compiled: ReturnType<typeof compilePluginSources>;
  try { compiled = compilePluginSources(plugin); }
  catch (error) { compiled = { sources: [], warnings: [{ path: 'sources', message: String(error) }] }; }
  function availability(slug: string): PluginAvailability {
    if (!compiled.sources.some(source => source.slug === slug)) return 'needs-configuration';
    const current = loadSourceConfig(plugin.workspaceRootPath, slug);
    if (!current) return 'missing';
    if (!validateSourceConfig(current).valid) return 'needs-configuration';
    if (!current.enabled || current.connectionStatus === 'local_disabled') return 'disabled';
    if (current.connectionStatus === 'needs_auth' || ((current.mcp?.authType && current.mcp.authType !== 'none' || current.api?.authType && current.api.authType !== 'none') && !current.isAuthenticated)) return 'needs-authentication';
    if (current.mcp?.transport === 'stdio') {
      try { if (!statSync(normalizePluginCommand(current.mcp.command ?? '', { pluginRoot: plugin.path })).isFile()) return 'missing-executable'; }
      catch { return 'missing-executable'; }
    }
    if (current.connectionStatus === 'failed') return 'connection-failed';
    if (current.type !== 'local' && current.connectionStatus !== 'connected') return 'not-connected';
    return 'configured'; // A disk configuration is not evidence of a live session connection.
  }
  return {
    name: plugin.name,
    description: plugin.manifest.description,
    icon: plugin.manifest.icon,
    version: plugin.manifest.version,
    author: plugin.manifest.author?.name,
    license: plugin.manifest.license,
    homepage: plugin.manifest.homepage,
    path: plugin.path,
    workspaceRelativePath: plugin.workspaceRelativePath,
    skills: plugin.resources.skills.map(skill => {
      const native = roster.find(entry => entry.slug === skill.slug);
      return { slug: skill.slug, name: native?.name ?? skill.slug, description: native?.description ?? '', availability: native ? 'configured' : 'missing' };
    }),
    sources: [
      ...plugin.resources.mcpServers.map((server) => ({
        slug: server.slug,
        type: 'mcp' as const,
        availability: availability(server.slug),
      })),
      ...plugin.resources.extensionSources.map((source) => ({
        slug: source.slug,
        type: source.type,
        availability: availability(source.slug),
      })),
    ].filter((source, index, all) => all.findIndex(candidate => candidate.slug === source.slug) === index),
    hasPromptFragment: Boolean(plugin.promptFragment),
    promptFragment: plugin.promptFragment ?? undefined,
    warnings: [...plugin.warnings, ...compiled.warnings],
  };
}

/** Project every loaded bundle in a workspace load result. */
export function summarizePluginsForRenderer(plugins: LoadedPlugin[]): PluginSummaryDto[] {
  return plugins.map(summarizePluginForRenderer);
}

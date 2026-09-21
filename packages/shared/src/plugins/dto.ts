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
  skills: Array<{ slug: string; name: string; description: string }>;
  sources: Array<{ slug: string; type: 'mcp' | 'api' | 'local' }>;
  hasPromptFragment: boolean;
  promptFragment?: string;
  warnings: Array<{ path: string; message: string }>;
}

/** Project a loaded bundle into its renderer-facing summary. */
export function summarizePluginForRenderer(plugin: LoadedPlugin): PluginSummaryDto {
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
    skills: plugin.resources.skills.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
    })),
    sources: [
      ...plugin.resources.mcpServers.map((server) => ({
        slug: server.slug,
        type: 'mcp' as const,
      })),
      ...plugin.resources.extensionSources.map((source) => ({
        slug: source.slug,
        type: source.type,
      })),
    ],
    hasPromptFragment: Boolean(plugin.promptFragment),
    promptFragment: plugin.promptFragment ?? undefined,
    warnings: plugin.warnings,
  };
}

/** Project every loaded bundle in a workspace load result. */
export function summarizePluginsForRenderer(plugins: LoadedPlugin[]): PluginSummaryDto[] {
  return plugins.map(summarizePluginForRenderer);
}

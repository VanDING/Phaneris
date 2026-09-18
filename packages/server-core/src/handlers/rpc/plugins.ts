/**
 * Plugins RPC
 *
 * The public surface for plugin bundles. Everything here is a thin wrapper over
 * `@phaneris/shared/plugins` — the install/uninstall semantics (D6 overwrite,
 * D9 two-phase confirmation, D10 reference counting, D11 symlink refusal) live
 * in the shared module and are deliberately NOT re-implemented here, so the
 * agent-facing tool path and the UI path cannot disagree about what an install
 * does.
 *
 * Install and uninstall are two-phase on purpose. `ANALYZE_*` computes the
 * plan without writing anything, the caller shows it (the overwrite list and
 * the verbatim stdio commands, D9), and only then does the `INSTALL` /
 * `UNINSTALL` channel run it. A single-phase API would make the confirmation a
 * client-side fiction.
 */

import { existsSync, statSync } from 'fs'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import type { RpcServer } from '@phaneris/server-core/transport'
import { getWorkspaceByNameOrId } from '@phaneris/shared/config'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.plugins.LIST,
  RPC_CHANNELS.plugins.ANALYZE_INSTALL,
  RPC_CHANNELS.plugins.INSTALL,
  RPC_CHANNELS.plugins.ANALYZE_UNINSTALL,
  RPC_CHANNELS.plugins.UNINSTALL,
] as const

/** Resolve a workspace or throw — every channel here is workspace-scoped. */
function requireWorkspace(workspaceId: string) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace
}

export function registerPluginsHandlers(server: RpcServer, deps: HandlerDeps): void {
  /**
   * List installed plugin bundles for a workspace.
   *
   * Returns both sides of a partial failure: `plugins` for the bundles that
   * loaded, `errors` for directories that did not. A broken bundle must be
   * visible in the sidebar rather than silently missing — otherwise the user
   * sees a plugin vanish and concludes the install failed.
   */
  server.handle(RPC_CHANNELS.plugins.LIST, async (_ctx, workspaceId: string) => {
    const workspace = requireWorkspace(workspaceId)
    const { loadAllPlugins, summarizePluginsForRenderer } = await import('@phaneris/shared/plugins')
    const { plugins, errors } = loadAllPlugins(workspace.rootPath)

    deps.platform.logger?.info(
      `PLUGINS_LIST: ${plugins.length} plugin(s), ${errors.length} load error(s) in ${workspace.rootPath}`,
    )

    return {
      plugins: summarizePluginsForRenderer(plugins),
      errors,
    }
  })

  /** D9 phase 1 — what an install would replace, including raw stdio commands. */
  server.handle(
    RPC_CHANNELS.plugins.ANALYZE_INSTALL,
    async (_ctx, workspaceId: string, packageRoot: string) => {
      const workspace = requireWorkspace(workspaceId)
      if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) {
        throw new Error(`Package path is not a directory: ${packageRoot}`)
      }

      const { analyzePluginInstall } = await import('@phaneris/shared/plugins')
      const plan = analyzePluginInstall(workspace.rootPath, packageRoot)

      return {
        name: plan.plugin.name,
        description: plan.plugin.manifest.description,
        overwrites: plan.overwrites,
        creates: plan.creates,
        // Verbatim, placeholders unexpanded: the user is approving the command
        // as the package author wrote it, not our interpretation of it (P5-5).
        stdioCommands: plan.stdioCommands,
        warnings: plan.warnings,
        packageRoot: plan.packageRoot,
        targetRoot: plan.targetRoot,
        skills: plan.plugin.resources.skills.map((skill) => skill.slug),
        sources: [
          ...plan.plugin.resources.mcpServers.map((server) => server.slug),
          ...plan.plugin.resources.extensionSources.map((source) => source.slug),
        ],
      }
    },
  )

  /** D9 phase 2 — perform the install the user approved. */
  server.handle(
    RPC_CHANNELS.plugins.INSTALL,
    async (_ctx, workspaceId: string, packageRoot: string) => {
      const workspace = requireWorkspace(workspaceId)
      const { installPluginFrom } = await import('@phaneris/shared/plugins')
      const result = installPluginFrom(workspace.rootPath, packageRoot)

      deps.platform.logger?.info(
        `PLUGINS_INSTALL: "${result.name}" — ${result.skills.length} skill(s), ` +
          `${result.sources.length} source(s), ${result.replaced.length} replaced`,
      )

      return result
    },
  )

  /** D10 phase 1 — what an uninstall would remove, and what it must keep. */
  server.handle(
    RPC_CHANNELS.plugins.ANALYZE_UNINSTALL,
    async (_ctx, workspaceId: string, pluginName: string) => {
      const workspace = requireWorkspace(workspaceId)
      const { analyzePluginUninstall } = await import('@phaneris/shared/plugins')
      return analyzePluginUninstall(workspace.rootPath, pluginName)
    },
  )

  /** D10 phase 2 — remove the plugin and the resources nobody else claims. */
  server.handle(
    RPC_CHANNELS.plugins.UNINSTALL,
    async (_ctx, workspaceId: string, pluginName: string) => {
      const workspace = requireWorkspace(workspaceId)
      const { uninstallPlugin } = await import('@phaneris/shared/plugins')
      const result = uninstallPlugin(workspace.rootPath, pluginName)

      deps.platform.logger?.info(
        `PLUGINS_UNINSTALL: "${result.name}" — removed ${result.removedSkills.length} skill(s), ` +
          `${result.removedSources.length} source(s); retained ${result.retained.length}`,
      )

      return result
    },
  )
}

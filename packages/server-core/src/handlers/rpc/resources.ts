/**
 * Resources RPC Handlers
 *
 * Handles workspace resource export/import (sources, skills, automations).
 */

import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFileSync, readJsonFileSync } from '@phaneris/shared/utils/files'
import { RESOURCE_ICON_IMAGE_SIZE, resourceIconKeySchema, resourceIconSchema } from '@phaneris/shared/resources/icons'
import { pushTyped } from '../../transport/push'
import { getWorkspaceByNameOrId } from '@phaneris/shared/config/workspace-selection';
import { getCredentialManager, SOURCE_CREDENTIAL_TYPES } from '@phaneris/shared/credentials'
import type { RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type {
  ResourceBundle,
  ResourceImportMode,
  ExportResourcesOptions,
} from '@phaneris/shared/resources'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.resources.EXPORT,
  RPC_CHANNELS.resources.IMPORT,
  RPC_CHANNELS.resources.GET_ICONS,
  RPC_CHANNELS.resources.SET_ICON,
] as const

const resourceIconsSchema = z.record(resourceIconKeySchema, resourceIconSchema)

export function registerResourcesHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.resources.GET_ICONS, (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const path = join(workspace.rootPath, 'resource-icons.json')
    return existsSync(path) ? resourceIconsSchema.parse(readJsonFileSync(path)) : {}
  })

  server.handle(RPC_CHANNELS.resources.SET_ICON, (_ctx, workspaceId, iconKey, icon) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    if (icon?.kind === 'image') {
      const png = Buffer.from(icon.src.slice('data:image/png;base64,'.length), 'base64')
      if (png.length < 33 || png.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
          png.toString('ascii', 12, 16) !== 'IHDR' ||
          png.readUInt32BE(16) === 0 || png.readUInt32BE(16) > RESOURCE_ICON_IMAGE_SIZE ||
          png.readUInt32BE(20) === 0 || png.readUInt32BE(20) > RESOURCE_ICON_IMAGE_SIZE) {
        throw new Error('Invalid resource icon image')
      }
    }
    const path = join(workspace.rootPath, 'resource-icons.json')
    const icons = existsSync(path) ? resourceIconsSchema.parse(readJsonFileSync(path)) : {}
    if (icon) icons[iconKey] = icon
    else delete icons[iconKey]
    const data = JSON.stringify(icons)
    // Keep the workspace snapshot comfortably below the transport frame limit.
    if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw new Error('Workspace resource icons exceed the storage limit')
    atomicWriteFileSync(path, data + '\n', { mode: 0o600 })
    pushTyped(server, RPC_CHANNELS.resources.ICON_CHANGED, { to: 'workspace', workspaceId: workspace.id }, workspace.id, iconKey, icon)
  })

  // Export workspace resources to a portable bundle
  server.handle(
    RPC_CHANNELS.resources.EXPORT,
    async (_ctx, workspaceId: string, options: ExportResourcesOptions) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const { exportResources } = await import('@phaneris/shared/resources')
      const result = exportResources(workspace.rootPath, options)

      deps.platform.logger?.info(
        `RESOURCES_EXPORT: Exported from ${workspaceId}: ` +
        `${result.bundle.resources.sources?.length ?? 0} sources, ` +
        `${result.bundle.resources.skills?.length ?? 0} skills, ` +
        `${result.bundle.resources.automations?.length ?? 0} automations` +
        (result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : ''),
      )

      return result
    },
  )

  // Import a resource bundle into a workspace
  server.handle(
    RPC_CHANNELS.resources.IMPORT,
    async (_ctx, workspaceId: string, bundle: ResourceBundle, mode: ResourceImportMode) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const { importResources } = await import('@phaneris/shared/resources')
      const credManager = getCredentialManager()

      const result = await importResources(workspace.rootPath, bundle, mode, {
        // Clear all credential types for a source slug on overwrite
        clearSourceCredentials: async (wsId: string, sourceSlug: string) => {
          for (const credType of SOURCE_CREDENTIAL_TYPES) {
            try {
              await credManager.delete({
                type: credType,
                workspaceId: wsId,
                sourceId: sourceSlug,
              })
            } catch {
              // Ignore errors for credential types that don't exist
            }
          }
        },
      })

      deps.platform.logger?.info(
        `RESOURCES_IMPORT: Imported into ${workspaceId} (mode=${mode}): ` +
        `sources=${result.sources.imported.length} imported, ${result.sources.skipped.length} skipped, ${result.sources.failed.length} failed; ` +
        `skills=${result.skills.imported.length} imported, ${result.skills.skipped.length} skipped, ${result.skills.failed.length} failed; ` +
        `automations=${result.automations.imported.length} imported, ${result.automations.skipped.length} skipped, ${result.automations.failed.length} failed`,
      )

      // Notify ConfigWatcher of imported files so UI refreshes on Linux
      // (Bun's fs.watch doesn't reliably detect atomic renames)
      if (result.automations.imported.length > 0 || result.automations.skipped.length === 0 && bundle.resources.automations?.length) {
        deps.sessionManager.notifyConfigFileChange(workspace.rootPath, 'automations.json')
      }
      for (const slug of result.sources.imported) {
        deps.sessionManager.notifyConfigFileChange(workspace.rootPath, `sources/${slug}/config.json`)
      }
      for (const slug of result.skills.imported) {
        deps.sessionManager.notifyConfigFileChange(workspace.rootPath, `skills/${slug}/SKILL.md`)
      }

      for (const name of result.plugins?.imported ?? []) {
        deps.sessionManager.notifyConfigFileChange(workspace.rootPath, `plugins/${name}/plugin.json`)
        const { loadPluginByName } = await import('@phaneris/shared/plugins')
        const plugin = loadPluginByName(workspace.rootPath, name)
        for (const skill of plugin?.resources.skills ?? []) {
          deps.sessionManager.notifyConfigFileChange(workspace.rootPath, `skills/${skill.slug}/SKILL.md`)
        }
        for (const source of [...(plugin?.resources.mcpServers ?? []), ...(plugin?.resources.extensionSources ?? [])]) {
          deps.sessionManager.notifyConfigFileChange(workspace.rootPath, `sources/${source.slug}/config.json`)
        }
      }
      return result
    },
  )
}

import { existsSync } from 'node:fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { WORKSPACES_DIR } from '@phaneris/shared/config/paths'
import { getWorkspaceByNameOrId, addWorkspace, setActiveWorkspace, updateWorkspaceRemoteServer, setRemoteServerToken, getRemoteServerTokenSync } from '@phaneris/shared/config/workspace-selection';
import { perf } from '@phaneris/shared/utils'
import { pushTyped, type RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { isValidWorkspaceRootPath } from '../../utils/path-validation'
import { readWorkspaceImage, writeWorkspaceImage } from '../../services/workspace-images'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.CHECK_SLUG,
  RPC_CHANNELS.workspaces.UPDATE_REMOTE,
  RPC_CHANNELS.window.GET_WORKSPACE,
  RPC_CHANNELS.window.GET_MODE,
  RPC_CHANNELS.window.SWITCH_WORKSPACE,
  RPC_CHANNELS.workspace.READ_IMAGE,
  RPC_CHANNELS.workspace.WRITE_IMAGE,
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.theme.GET_PREFERENCES,
  RPC_CHANNELS.theme.SET_PREFERENCES,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.SET_COLOR_THEME,
  RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
  RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES,
  RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME,
  RPC_CHANNELS.views.LIST,
  RPC_CHANNELS.views.SAVE,
  RPC_CHANNELS.toolIcons.GET_MAPPINGS,
  RPC_CHANNELS.logo.GET_URL,
] as const

export function registerWorkspaceCoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps
  const windowManager = deps.windowManager

  // Get workspaces (LOCAL_ONLY — includes rootPath for local Electron renderer)
  server.handle(RPC_CHANNELS.workspaces.GET, async () => {
    return sessionManager.getWorkspaces()
  })

  // Create a new workspace at a folder path (Obsidian-style: folder IS the workspace)
  server.handle(RPC_CHANNELS.workspaces.CREATE, async (_ctx, folderPath: string, name: string, remoteServer?: { url: string; token?: string; remoteWorkspaceId: string; allowInsecureTls?: boolean }) => {
    const rootPath = folderPath.trim()
    const validation = isValidWorkspaceRootPath(rootPath)
    if (!validation.valid) {
      throw new Error(validation.reason!)
    }

    const token = remoteServer?.token
    const metadata = remoteServer ? { url: remoteServer.url, remoteWorkspaceId: remoteServer.remoteWorkspaceId, allowInsecureTls: remoteServer.allowInsecureTls } : undefined
    const workspace = addWorkspace({ name, rootPath, ...(metadata && { remoteServer: metadata }) })
    if (token) await setRemoteServerToken(workspace.id, token)
    // Make it active
    setActiveWorkspace(workspace.id)
    deps.platform.logger.info(`Created workspace "${name}" at ${rootPath}${remoteServer ? ` (remote: ${remoteServer.url})` : ''}`)
    return workspace
  })

  // Check if a workspace slug already exists (for validation before creation)
  server.handle(RPC_CHANNELS.workspaces.CHECK_SLUG, async (_ctx, slug: string) => {
    const defaultWorkspacesDir = WORKSPACES_DIR
    const workspacePath = join(defaultWorkspacesDir, slug)
    const exists = existsSync(workspacePath)
    return { exists, path: workspacePath }
  })

  // Update remote server config for an existing workspace (reconnect flow)
  server.handle(RPC_CHANNELS.workspaces.UPDATE_REMOTE, async (_ctx, workspaceId: string, remoteServer: { url: string; token?: string; remoteWorkspaceId: string; allowInsecureTls?: boolean }) => {
    await updateWorkspaceRemoteServer(workspaceId, remoteServer)
    deps.platform.logger.info(`Updated remote server for workspace ${workspaceId}: ${remoteServer.url}`)
    return { success: true }
  })

  // Get workspace ID for the calling window
  server.handle(RPC_CHANNELS.window.GET_WORKSPACE, (ctx) => {
    const workspaceId = ctx.workspaceId ?? windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    // Set up the workspace-scoped watcher (global user themes have one watcher
    // owned by SessionManager).
    if (workspaceId) {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (workspace) {
        sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
      }
    }
    return workspaceId
  })

  // Get mode for the calling window (always 'main' now)
  server.handle(RPC_CHANNELS.window.GET_MODE, () => {
    return 'main'
  })

  // Switch workspace in current window (in-window switching)
  server.handle(RPC_CHANNELS.window.SWITCH_WORKSPACE, async (ctx, workspaceId: string) => {
    const end = perf.start('ipc.switchWorkspace', { workspaceId })

    // Keep WS push routing in sync (works for both GUI and headless)
    server.updateClientWorkspace?.(ctx.clientId, workspaceId)

    if (windowManager) {
      const wcId = ctx.webContentsId!

      // Get the old workspace ID before updating
      const oldWorkspaceId = windowManager.getWorkspaceForWindow(wcId)

      // Update the window's workspace mapping
      const updated = windowManager.updateWindowWorkspace(wcId, workspaceId)

      // If update failed, the window may have been re-created (e.g., after refresh)
      // Try to register it
      if (!updated) {
        const win = windowManager.getWindowByWebContentsId(wcId)
        if (win) {
          windowManager.registerWindow(win, workspaceId)
          deps.platform.logger.info(`Re-registered window ${wcId} for workspace ${workspaceId}`)
        }
      }

      // Clear activeViewingSession for old workspace if no other windows are viewing it
      // This ensures read/unread state is correct after workspace switch
      if (oldWorkspaceId && oldWorkspaceId !== workspaceId) {
        const otherWindows = windowManager.getAllWindowsForWorkspace(oldWorkspaceId)
        if (otherWindows.length === 0) {
          sessionManager.clearActiveViewingSession(oldWorkspaceId)
        }
      }
    }

    // Set up ConfigWatcher for the new workspace
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (workspace) {
      sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
    }
    end()

    // Return connection details so the preload RoutedClient can decide
    // whether to connect directly to a remote server for this workspace.
    return {
      workspaceId,
      remoteServer: workspace?.remoteServer
        ? { ...workspace.remoteServer, token: getRemoteServerTokenSync(workspaceId) }
        : null,
    }
  })

  // ============================================================
  // Workspace Image Read/Write
  // ============================================================

  server.handle(RPC_CHANNELS.workspace.READ_IMAGE, (_ctx, workspaceId: string, relativePath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return readWorkspaceImage(workspace.rootPath, relativePath)
  })

  server.handle(RPC_CHANNELS.workspace.WRITE_IMAGE, async (_ctx, workspaceId: string, relativePath: string, base64: string, mimeType: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    await writeWorkspaceImage(workspace.rootPath, relativePath, base64, mimeType, deps.platform.imageProcessor, deps.platform.logger)
  })

  // ============================================================
  // Theme (app-level only)
  // ============================================================

  server.handle(RPC_CHANNELS.theme.GET_APP, async () => {
    const { loadAppTheme } = await import('@phaneris/shared/config/storage')
    return loadAppTheme()
  })

  // User themes (app-level; Default is returned directly by LOAD_PRESET)
  server.handle(RPC_CHANNELS.theme.GET_PRESETS, async () => {
    const { loadPresetThemes } = await import('@phaneris/shared/config/storage')
    return loadPresetThemes()
  })

  server.handle(RPC_CHANNELS.theme.LOAD_PRESET, async (_ctx, themeId: string) => {
    const { loadPresetTheme } = await import('@phaneris/shared/config/storage')
    return loadPresetTheme(themeId)
  })

  server.handle(RPC_CHANNELS.theme.GET_PREFERENCES, async () => {
    const { getThemePreferences } = await import('@phaneris/shared/config/storage')
    return getThemePreferences()
  })

  server.handle(RPC_CHANNELS.theme.SET_PREFERENCES, async (_ctx, preferences: import('@phaneris/shared/config').ThemePreferences) => {
    const { setThemePreferences } = await import('@phaneris/shared/config/storage')
    const persisted = setThemePreferences(preferences)
    deps.browserPaneManager?.refreshThemeVisuals?.()
    pushTyped(server, RPC_CHANNELS.theme.PREFERENCES_CHANGED, { to: 'all' }, persisted)
    return persisted
  })

  server.handle(RPC_CHANNELS.theme.GET_COLOR_THEME, async () => {
    const { getColorTheme } = await import('@phaneris/shared/config/storage')
    return getColorTheme()
  })

  server.handle(RPC_CHANNELS.theme.SET_COLOR_THEME, async (_ctx, themeId: string) => {
    const { getThemePreferences, setColorTheme } = await import('@phaneris/shared/config/storage')
    setColorTheme(themeId)
    deps.browserPaneManager?.refreshThemeVisuals?.()
    pushTyped(server, RPC_CHANNELS.theme.PREFERENCES_CHANGED, { to: 'all' }, getThemePreferences())
  })

  // Backward-compatible alias for older clients; persistence and broadcast now
  // happen together so config.json remains authoritative.
  server.handle(RPC_CHANNELS.theme.BROADCAST_PREFERENCES, async (_ctx, preferences: import('@phaneris/shared/config').ThemePreferences) => {
    const { setThemePreferences } = await import('@phaneris/shared/config/storage')
    const persisted = setThemePreferences(preferences)
    deps.browserPaneManager?.refreshThemeVisuals?.()
    pushTyped(server, RPC_CHANNELS.theme.PREFERENCES_CHANGED, { to: 'all' }, persisted)
  })

  // Workspace-level theme overrides
  server.handle(RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, async (_ctx, workspaceId: string) => {
    const { getWorkspaces } = await import('@phaneris/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@phaneris/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return null
    return getWorkspaceColorTheme(workspace.rootPath) ?? null
  })

  server.handle(RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, async (_ctx, workspaceId: string, themeId: string | null) => {
    const { getWorkspaces } = await import('@phaneris/shared/config/storage')
    const { getWorkspaceColorTheme, setWorkspaceColorTheme } = await import('@phaneris/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return
    setWorkspaceColorTheme(workspace.rootPath, themeId ?? undefined)
    const persistedThemeId = getWorkspaceColorTheme(workspace.rootPath) ?? null
    deps.browserPaneManager?.refreshThemeVisuals?.()
    pushTyped(server, RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED, { to: 'all' }, { workspaceId, themeId: persistedThemeId })
  })

  server.handle(RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES, async () => {
    const { getWorkspaces } = await import('@phaneris/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@phaneris/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const themes: Record<string, string | undefined> = {}
    for (const ws of workspaces) {
      themes[ws.id] = getWorkspaceColorTheme(ws.rootPath)
    }
    return themes
  })

  // Broadcast workspace theme change to all other windows (for cross-window sync)
  server.handle(RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME, async (_ctx, workspaceId: string, themeId: string | null) => {
    deps.browserPaneManager?.refreshThemeVisuals?.()
    pushTyped(server, RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED, { to: 'all' }, { workspaceId, themeId })
  })

  // ============================================================
  // Views
  // ============================================================

  // List views for a workspace (dynamic expression-based filters stored in views.json)
  server.handle(RPC_CHANNELS.views.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listViews } = await import('@phaneris/shared/views/storage')
    return listViews(workspace.rootPath)
  })

  // Save views (replaces full array)
  server.handle(RPC_CHANNELS.views.SAVE, async (_ctx, workspaceId: string, views: import('@phaneris/shared/views').ViewConfig[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveViews } = await import('@phaneris/shared/views/storage')
    saveViews(workspace.rootPath, views)
    // Broadcast labels changed since views are used alongside labels in sidebar
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  })

  // ============================================================
  // Tool Icons and Logo
  // ============================================================

  // Tool icon mappings — loads tool-icons.json and resolves each entry's icon to a data URL
  // for display in the Appearance settings page
  server.handle(RPC_CHANNELS.toolIcons.GET_MAPPINGS, async () => {
    const { getToolIconsDir } = await import('@phaneris/shared/config/storage')
    const { loadToolIconConfig } = await import('@phaneris/shared/utils/cli-icon-resolver')
    const { encodeIconToDataUrl } = await import('@phaneris/shared/utils/icon-encoder')
    const { join } = await import('path')

    const toolIconsDir = getToolIconsDir()
    const config = loadToolIconConfig(toolIconsDir)
    if (!config) return []

    return config.tools
      .map(tool => {
        const iconPath = join(toolIconsDir, tool.icon)
        const iconDataUrl = encodeIconToDataUrl(iconPath)
        if (!iconDataUrl) return null
        return {
          id: tool.id,
          displayName: tool.displayName,
          iconDataUrl,
          commands: tool.commands,
        }
      })
      .filter(Boolean)
  })

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  server.handle(RPC_CHANNELS.logo.GET_URL, async (_ctx, serviceUrl: string, provider?: string) => {
    const { getCachedLogo } = await import('@phaneris/shared/utils/logo-cache')
    const result = await getCachedLogo(serviceUrl, provider)
    return result
  })
}

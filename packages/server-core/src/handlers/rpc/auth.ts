import { unlink } from 'fs/promises'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { CONFIG_FILE } from '@phaneris/shared/config/paths'
import { getCredentialManager } from '@phaneris/shared/credentials'
import type { RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { requestClientConfirmDialog } from '@phaneris/server-core/transport'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.auth.LOGOUT,
  RPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION,
  RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION,
  RPC_CHANNELS.credentials.HEALTH_CHECK,
] as const

export function registerAuthHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Show logout confirmation dialog (routed to client)
  //
  // The `i18n` descriptor is what a client *should* render; the English
  // `title`/`message`/`detail`/`buttons` above it stay as the fallback a client
  // without i18n renders. Servers must not ship translated copy over the wire —
  // see `ConfirmDialogSpec.i18n`.
  server.handle(RPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION, async (ctx) => {
    const result = await requestClientConfirmDialog(server, ctx.clientId, {
      type: 'warning',
      buttons: ['Cancel', 'Log Out'],
      defaultId: 0,
      cancelId: 0,
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      detail: 'All conversations will be deleted. This action cannot be undone.',
      i18n: {
        titleKey: 'dialog.logout.title',
        messageKey: 'dialog.logoutConfirmation',
        detailKey: 'dialog.logout.detail',
        confirmKey: 'dialog.logout.confirm',
        cancelKey: 'common.cancel',
      },
    })
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Log Out
    return result.response === 1
  })

  // Show delete session confirmation dialog (routed to client)
  server.handle(RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION, async (ctx, name: string) => {
    const result = await requestClientConfirmDialog(server, ctx.clientId, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Conversation',
      message: `Are you sure you want to delete: "${name}"?`,
      detail: 'This action cannot be undone.',
      i18n: {
        titleKey: 'dialog.deleteSession.title',
        messageKey: 'dialog.deleteSessionConfirmation',
        detailKey: 'dialog.deleteSession.detail',
        confirmKey: 'common.delete',
        cancelKey: 'common.cancel',
        // `dialog.deleteSessionConfirmation` interpolates the conversation name.
        values: { name },
      },
    })
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Delete
    return result.response === 1
  })

  // Logout - clear all credentials and config
  //
  // M-8: requires an explicit `confirm: true` flag in the payload so a stray or
  // malicious invocation cannot wipe every stored credential and the config
  // file without the user's consent. The renderer already shows a native
  // confirmation dialog before invoking this (see executeReset in App.tsx), so
  // this is a wire-level guard: the caller must pass `{ confirm: true }`.
  server.handle(RPC_CHANNELS.auth.LOGOUT, async (_ctx, payload?: { confirm?: boolean }) => {
    if (!payload || payload.confirm !== true) {
      return { success: false, error: 'Confirmation required' }
    }
    try {
      const manager = getCredentialManager()

      // List and delete all stored credentials
      const allCredentials = await manager.list()
      for (const credId of allCredentials) {
        await manager.delete(credId)
      }

      // Delete the config file
      const configPath = CONFIG_FILE
      await unlink(configPath).catch(() => {
        // Ignore if file doesn't exist
      })

      deps.platform.logger.info('Logout complete - cleared all credentials and config')
    } catch (error) {
      deps.platform.logger.error('Logout error:', error)
      throw error
    }
  })

  // Credential health check - validates credential store is readable and usable
  // Called on app startup to detect corruption, machine migration, or missing credentials
  server.handle(RPC_CHANNELS.credentials.HEALTH_CHECK, async () => {
    const manager = getCredentialManager()
    return manager.checkHealth()
  })
}

/**
 * Cross-tree notification that a workspace's stored settings changed.
 *
 * The settings page and the chat surface are separate renderer trees, so a saved
 * workspace setting has to be announced for the shells that cache it to reload.
 * `detail.workspaceId` scopes the reload; omitting it means "reload everything".
 */
export const WORKSPACE_SETTINGS_CHANGED_EVENT = 'phaneris:workspace-settings-changed'

export interface WorkspaceSettingsChangedDetail {
  workspaceId?: string
}

/** Announce a write. Safe to call where no listener exists (plain DOM event). */
export function announceWorkspaceSettingsChanged(workspaceId?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<WorkspaceSettingsChangedDetail>(WORKSPACE_SETTINGS_CHANGED_EVENT, {
    detail: { workspaceId },
  }))
}

/**
 * Workspace settings that belong to exactly one workspace.
 *
 * Extracted from `AppShell` so the isolation rules can be verified against real
 * components instead of being re-implemented by a test:
 *
 * - the chips are cleared the moment the active workspace changes, so workspace
 *   A's starters are never offered to a session in workspace B while B loads (or
 *   when B's read fails);
 * - every read carries a request sequence and an effect-lifetime flag, so a late
 *   response from a superseded read — or from a workspace the user already left —
 *   is dropped instead of overwriting newer data.
 */

import * as React from 'react'
import type { ChatStarter } from '@phaneris/shared/workspaces/chat-starters'
import { WORKSPACE_SETTINGS_CHANGED_EVENT } from '@/lib/workspace-settings-events'

/** The subset of workspace settings this hook reports back to its owner. */
export interface WorkspaceSettingsSnapshot {
  localMcpEnabled?: boolean
  cyclablePermissionModes?: import('@phaneris/shared/agent/modes').PermissionMode[]
  chatStarters?: ChatStarter[]
}

export function useWorkspaceChatStarters(
  activeWorkspaceId: string | null,
  onSettingsLoaded?: (settings: WorkspaceSettingsSnapshot) => void,
): ChatStarter[] {
  const [snapshot, setSnapshot] = React.useState<{ workspaceId: string; starters: ChatStarter[] } | null>(null)
  // The callback is usually an inline arrow from the caller; keeping it in a ref
  // stops it from re-running the whole load on every render.
  const loadedRef = React.useRef(onSettingsLoaded)
  loadedRef.current = onSettingsLoaded

  React.useEffect(() => {
    if (!activeWorkspaceId) {
      // No active workspace: never keep another workspace's chips on screen.
      setSnapshot(null)
      return
    }
    // Clear first: while this workspace's settings are still loading — or if the
    // read fails — the previous workspace's chips must not be offered to a
    // session that belongs to this one.
    setSnapshot(null)
    let cancelled = false
    // A settings write can land while a read is in flight; only the newest
    // request may apply its result, or an older response overwrites newer data.
    let requestId = 0
    const load = () => {
      const requested = ++requestId
      const isCurrent = () => !cancelled && requested === requestId
      window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
        if (!isCurrent()) return
        if (settings) {
          loadedRef.current?.(settings as WorkspaceSettingsSnapshot)
          setSnapshot({ workspaceId: activeWorkspaceId, starters: (settings.chatStarters ?? []) as ChatStarter[] })
        }
      }).catch((err) => {
        if (!isCurrent()) return
        console.error('[Chat] Failed to load workspace settings:', err)
        // A failed read shows no starters for this workspace rather than the
        // ones the previous workspace had.
        setSnapshot(null)
      })
    }
    load()
    // The settings page reports its writes; reload so a saved starter shows up
    // without reopening the workspace or the settings page.
    const onChanged = (event: Event) => {
      const changed = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      if (!changed || changed === activeWorkspaceId) load()
    }
    window.addEventListener(WORKSPACE_SETTINGS_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(WORKSPACE_SETTINGS_CHANGED_EVENT, onChanged)
    }
  }, [activeWorkspaceId])

  return snapshot?.workspaceId === activeWorkspaceId ? snapshot.starters : []
}

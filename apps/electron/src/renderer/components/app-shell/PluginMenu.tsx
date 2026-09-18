/**
 * PluginMenu - Shared menu content for plugin bundle actions
 *
 * Used by:
 * - PluginsListPanel (dropdown via "..." button, context menu via right-click)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent plugin actions:
 * - Show in file manager
 * - Uninstall (D10: two-phase, so the caller opens the confirmation)
 *
 * Deliberately no install entry point: installing a bundle is docs-driven (the
 * agent walks the user through it), so the UI only ever removes them.
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import {
  Trash2,
  FolderOpen,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getFileManagerName } from '@/lib/platform'

export interface PluginMenuProps {
  /** Reveal the plugin root in the OS file manager */
  onShowInFinder: () => void | Promise<void>
  /** Open the uninstall confirmation (already analyzed) */
  onUninstall: () => void
  canShowInFinder?: boolean
  canUninstall?: boolean
}

/**
 * PluginMenu - Renders the menu items for plugin actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function PluginMenu({
  onShowInFinder,
  onUninstall,
  canShowInFinder = true,
  canUninstall = true,
}: PluginMenuProps) {
  const { t } = useTranslation()

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Show in file manager — remote workspaces have no local path to reveal */}
      <MenuItem onClick={onShowInFinder} disabled={!canShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{t("pluginsList.showInFinder", { fileManager: getFileManagerName() })}</span>
      </MenuItem>

      <Separator />

      {/* Uninstall */}
      <MenuItem onClick={canUninstall ? onUninstall : undefined} variant="destructive" disabled={!canUninstall}>
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t("pluginsList.uninstallPlugin")}</span>
      </MenuItem>
    </>
  )
}

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
  Send,
  FolderOpen,
} from 'lucide-react'
import { MenuEntries } from '@/components/ui/menu-entries'
import type { MenuEntry } from '@phaneris/ui'
import { getFileManagerName } from '@/lib/platform'

export interface PluginMenuProps {
  /** Reveal the plugin root in the OS file manager */
  onShowInFinder: () => void | Promise<void>
  /** Open the uninstall confirmation (already analyzed) */
  onUninstall: () => void
  canShowInFinder?: boolean
  canUninstall?: boolean
  onSendToWorkspace?: () => void
}

/**
 * PluginMenu - Renders the menu items for plugin actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function PluginMenu({
  onShowInFinder,
  onUninstall,
  onSendToWorkspace,
  canShowInFinder = true,
  canUninstall = true,
}: PluginMenuProps) {
  const { t } = useTranslation()

  const entries: MenuEntry[] = [
    { label: t("pluginsList.showInFinder", { fileManager: getFileManagerName() }), icon: <FolderOpen className="h-3.5 w-3.5" />, disabled: !canShowInFinder, onSelect: onShowInFinder },
    ...(onSendToWorkspace
      ? [{ label: t('sessionMenu.sendToWorkspace'), icon: <Send className="h-3.5 w-3.5" />, onSelect: onSendToWorkspace } satisfies MenuEntry]
      : []),
    { kind: 'separator' },
    { label: t("pluginsList.uninstallPlugin"), icon: <Trash2 className="h-3.5 w-3.5" />, variant: 'destructive', disabled: !canUninstall, onSelect: canUninstall ? onUninstall : undefined },
  ]

  return <MenuEntries entries={entries} />
}

/**
 * SourceMenu - Shared menu content for source actions
 *
 * Used by:
 * - SourcesListPanel (dropdown via "..." button, context menu via right-click)
 * - SourceInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent source actions:
 * - Open in New Window
 * - Show in file manager
 * - Delete
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import {
  Trash2,
  FolderOpen,
  AppWindow,
  Send,
} from 'lucide-react'
import { MenuEntries } from '@/components/ui/menu-entries'
import type { MenuEntry } from '@phaneris/ui'
import { getFileManagerName } from '@/lib/platform'

export interface SourceMenuProps {
  /** Source slug */
  sourceSlug: string
  /** Source name for display */
  sourceName: string
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder: () => void
  onDelete: () => void
  /** Send to another workspace (omit to hide the option) */
  onSendToWorkspace?: () => void
}

/**
 * SourceMenu - Renders the menu items for source actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SourceMenu({
  sourceSlug,
  sourceName,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
  onSendToWorkspace,
}: SourceMenuProps) {
  const { t } = useTranslation()

  const entries: MenuEntry[] = [
    { label: t("sidebarMenu.openInNewWindow"), icon: <AppWindow className="h-3.5 w-3.5" />, onSelect: onOpenInNewWindow },
    { label: t("sessionMenu.showInFileManager", { fileManager: getFileManagerName() }), icon: <FolderOpen className="h-3.5 w-3.5" />, onSelect: onShowInFinder },
    ...(onSendToWorkspace
      ? [{ label: t("sessionMenu.sendToWorkspace"), icon: <Send className="h-3.5 w-3.5" />, onSelect: onSendToWorkspace } satisfies MenuEntry]
      : []),
    { kind: 'separator' },
    { label: t("sidebarMenu.deleteSource"), icon: <Trash2 className="h-3.5 w-3.5" />, variant: 'destructive', onSelect: onDelete },
  ]

  return <MenuEntries entries={entries} />
}

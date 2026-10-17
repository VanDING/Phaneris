/**
 * SkillMenu - Shared menu content for skill actions
 *
 * Used by:
 * - SkillsListPanel (dropdown via "..." button, context menu via right-click)
 * - SkillInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent skill actions:
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

export interface SkillMenuProps {
  /** Skill slug */
  skillSlug: string
  /** Skill name for display */
  skillName: string
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder: () => void | Promise<void>
  onDelete?: () => void
  canShowInFinder?: boolean
  canDelete?: boolean
  deleteLabel?: string
  /** Send to another workspace (omit to hide the option) */
  onSendToWorkspace?: () => void
}

/**
 * SkillMenu - Renders the menu items for skill actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SkillMenu({
  skillSlug,
  skillName,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
  canShowInFinder = true,
  canDelete = true,
  deleteLabel,
  onSendToWorkspace,
}: SkillMenuProps) {
  const { t } = useTranslation()

  const entries: MenuEntry[] = [
    { label: t("sidebarMenu.openInNewWindow"), icon: <AppWindow className="h-3.5 w-3.5" />, onSelect: onOpenInNewWindow },
    { label: t("sessionMenu.showInFileManager", { fileManager: getFileManagerName() }), icon: <FolderOpen className="h-3.5 w-3.5" />, disabled: !canShowInFinder, onSelect: onShowInFinder },
    ...(onSendToWorkspace
      ? [{ label: t("sessionMenu.sendToWorkspace"), icon: <Send className="h-3.5 w-3.5" />, onSelect: onSendToWorkspace } satisfies MenuEntry]
      : []),
    { kind: 'separator' },
    { label: deleteLabel || t("sidebarMenu.deleteSkill"), icon: <Trash2 className="h-3.5 w-3.5" />, variant: 'destructive', disabled: !canDelete, onSelect: canDelete ? onDelete : undefined },
  ]

  return <MenuEntries entries={entries} />
}

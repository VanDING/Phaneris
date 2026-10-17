/**
 * SidebarMenu - Shared menu content for sidebar navigation items
 *
 * Used by:
 * - LeftSidebar (context menu via right-click on nav items)
 * - AppShell (context menu for New Chat button)
 *
 * Entries are described as data and rendered through the shared MenuEntries
 * adapter, which works with either DropdownMenu or ContextMenu primitives.
 *
 * Provides actions based on the sidebar item type:
 * - "Configure Statuses" (for allSessions/status/flagged items) - triggers EditPopover callback
 * - "Add Source" (for sources) - triggers EditPopover callback
 * - "Add Skill" (for skills) - triggers EditPopover callback
 * - "Open in New Window" (for newSession only) - uses deep link
 */

import { useTranslation } from "react-i18next"
import {
  AppWindow,
  CheckCheck,
  Settings2,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import { MenuEntries } from '@/components/ui/menu-entries'
import type { MenuEntry } from '@phaneris/ui'
import { getDocSlug, type DocFeature } from '@phaneris/shared/docs/doc-links'
import { openDocs } from '@/atoms/docs'

export type SidebarMenuType = 'allSessions' | 'flagged' | 'status' | 'sources' | 'skills' | 'plugins' | 'automations' | 'projects' | 'labels' | 'views' | 'newSession'

export interface SidebarMenuProps {
  /** Type of sidebar item (determines available menu items) */
  type: SidebarMenuType
  /** Status ID for status items (e.g., 'todo', 'done') - not currently used but kept for future */
  statusId?: string
  /** Label ID — when set, this is an individual label item (enables Delete Label) */
  labelId?: string
  /** Handler for "Configure Statuses" action - only for allSessions/status/flagged types */
  onConfigureStatuses?: () => void
  /** Handler for "Mark All Read" action - only for allSessions type */
  onMarkAllRead?: () => void
  /** Handler for "Configure Labels" action - receives labelId when triggered from a specific label */
  onConfigureLabels?: (labelId?: string) => void
  /** Handler for "Add New Label" action - creates a label (parentId = labelId if set) */
  onAddLabel?: (parentId?: string) => void
  /** Handler for "Delete Label" action - deletes the label identified by labelId */
  onDeleteLabel?: (labelId: string) => void
  /** Handler for "Add Source" action - only for sources type */
  onAddSource?: () => void
  /** Handler for "Add Skill" action - only for skills type */
  onAddSkill?: () => void
  /** Handler for "Add Automation" action - only for automations type */
  onAddAutomation?: () => void
  /** Handler for "Add Project" action - only for projects type */
  onAddProject?: () => void
  /** Source type filter for "Learn More" link - determines which docs page to open */
  sourceType?: 'api' | 'mcp' | 'local'
  /** Handler for "Edit Views" action - for views type */
  onConfigureViews?: () => void
  /** View ID — when set, this is an individual view (enables Delete) */
  viewId?: string
  /** Handler for "Delete View" action */
  onDeleteView?: (id: string) => void
}

/**
 * SidebarMenu - Renders the menu items for sidebar navigation actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SidebarMenu({
  type,
  statusId: _statusId,
  labelId,
  onConfigureStatuses,
  onMarkAllRead,
  onConfigureLabels,
  onAddLabel,
  onDeleteLabel,
  onAddSource,
  onAddSkill,
  onAddAutomation,
  onAddProject,
  sourceType,
  onConfigureViews,
  viewId,
  onDeleteView,
}: SidebarMenuProps) {
  const { t } = useTranslation()
  const entries: MenuEntry[] = []

  // New Session: only shows "Open in New Window"
  if (type === 'newSession') {
    return (
      <MenuEntries entries={[{
        label: t("sidebarMenu.openInNewWindow"),
        icon: <AppWindow className="h-3.5 w-3.5" />,
        onSelect: () => window.electronAPI.openUrl('phaneris://action/new-session?window=focused'),
      }]} />
    )
  }

  // All Sessions / Status / Flagged: show "Configure Statuses" (+ "Mark All Read" for allSessions)
  if ((type === 'allSessions' || type === 'status' || type === 'flagged') && onConfigureStatuses) {
    if (type === 'allSessions' && onMarkAllRead) {
      entries.push(
        { label: t("sidebarMenu.markAllRead"), icon: <CheckCheck className="h-3.5 w-3.5" />, onSelect: onMarkAllRead },
        { kind: 'separator' },
      )
    }
    entries.push({ label: t("sidebarMenu.configureStatuses"), icon: <Settings2 className="h-3.5 w-3.5" />, onSelect: onConfigureStatuses })
    return <MenuEntries entries={entries} />
  }

  // Labels: header gets Configure + Add; an individual label adds Delete.
  if (type === 'labels') {
    if (onAddLabel) entries.push({ label: t("sidebarMenu.addNewLabel"), icon: <Plus className="h-3.5 w-3.5" />, onSelect: () => onAddLabel(labelId) })
    if (onConfigureLabels) entries.push({ label: t("sidebarMenu.editLabels"), icon: <Settings2 className="h-3.5 w-3.5" />, onSelect: () => onConfigureLabels(labelId) })
    if (labelId && onDeleteLabel) {
      entries.push(
        { kind: 'separator' },
        { label: t("sidebarMenu.deleteLabel"), icon: <Trash2 className="h-3.5 w-3.5" />, onSelect: () => onDeleteLabel(labelId) },
      )
    }
    return <MenuEntries entries={entries} />
  }

  // Views: "Edit Views" and optionally "Delete View"
  if (type === 'views') {
    if (onConfigureViews) entries.push({ label: t("sidebarMenu.editViews"), icon: <Settings2 className="h-3.5 w-3.5" />, onSelect: onConfigureViews })
    if (viewId && onDeleteView) {
      entries.push(
        { kind: 'separator' },
        { label: t("sidebarMenu.deleteView"), icon: <Trash2 className="h-3.5 w-3.5" />, onSelect: () => onDeleteView(viewId) },
      )
    }
    return <MenuEntries entries={entries} />
  }

  // Sources: "Add Source" and "Learn More"
  if (type === 'sources') {
    const docFeature: DocFeature = sourceType
      ? `sources-${sourceType}` as DocFeature
      : 'sources'
    const learnMoreLabel = sourceType === 'api'
      ? t('sidebarMenu.learnMoreApis')
      : sourceType === 'mcp'
        ? t('sidebarMenu.learnMoreMcp')
        : sourceType === 'local'
          ? t('sidebarMenu.learnMoreLocalFolders')
          : t('sidebarMenu.learnMoreSources')
    if (onAddSource) entries.push({ label: t("sidebarMenu.addSource"), icon: <Plus className="h-3.5 w-3.5" />, onSelect: onAddSource })
    entries.push(
      { kind: 'separator' },
      { label: learnMoreLabel, icon: <ExternalLink className="h-3.5 w-3.5" />, onSelect: () => openDocs(getDocSlug(docFeature)) },
    )
    return <MenuEntries entries={entries} />
  }

  // Skills: "Add Skill"
  if (type === 'skills' && onAddSkill) {
    return <MenuEntries entries={[{ label: t("sidebarMenu.addSkill"), icon: <Plus className="h-3.5 w-3.5" />, onSelect: onAddSkill }]} />
  }

  // Projects: "Add Project"
  if (type === 'projects') {
    if (onAddProject) entries.push({ label: t("sidebarMenu.addProject"), icon: <Plus className="h-3.5 w-3.5" />, onSelect: onAddProject })
    return <MenuEntries entries={entries} />
  }

  // Automations: "Add Automation" and "Learn More"
  if (type === 'automations') {
    if (onAddAutomation) entries.push({ label: t("sidebarMenu.addAutomation"), icon: <Plus className="h-3.5 w-3.5" />, onSelect: onAddAutomation })
    entries.push(
      { kind: 'separator' },
      { label: t("sidebarMenu.learnMoreAutomations"), icon: <ExternalLink className="h-3.5 w-3.5" />, onSelect: () => openDocs(getDocSlug('automations')) },
    )
    return <MenuEntries entries={entries} />
  }

  // No handler provided (shouldn't happen)
  return null
}
